const express = require("express");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { randomUUID } = require("crypto");
const multer = require("multer");
const jwt = require("jsonwebtoken");

const Logging = require("../classes/logging");
const triggertype = require("../logging/triggertype");
const taskstate = require("../logging/taskstate");
const taskName = require("../logging/taskName");
const sanitizeFilename = require("../utils/sanitizer");
const { getBackupDir } = require("../utils/storage-paths");
const { assertPathInside, fileRateLimit } = require("../utils/security");
const db = require("../db");
const { addAuditEntry } = require("../classes/admin-history");
const { tables } = require("../global/backup_tables");
const configClass = require("../classes/config");

const { sendUpdate } = require("../ws");

const router = express.Router();
router.use(fileRateLimit);
const TaskManager = require("../classes/task-manager-singleton");
const TaskScheduler = require("../classes/task-scheduler-singleton");
const restorableTables = new Set(tables.map((table) => table.value));

// Database connection parameters
const postgresUser = process.env.POSTGRES_USER;
const postgresPassword = process.env.POSTGRES_PASSWORD;
const postgresIp = process.env.POSTGRES_IP;
const postgresPort = process.env.POSTGRES_PORT;
const postgresDatabase = process.env.POSTGRES_DB || "jellyglance";
const postgresSslRejectUnauthorized = process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED === undefined ? true : process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED === "true";
const jwtSecret = process.env.JWT_SECRET;

// Restore function

function readFile(filePath) {
  const safePath = assertPathInside(getBackupDir(), filePath);
  return new Promise((resolve, reject) => {
    fs.readFile(safePath, "utf8", (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const json = JSON.parse(data);
      resolve(json);
    });
  });
}

function getBirthtimeFallback(fileStats, fileName) {
  // Try to get birthtime metadata
  if (fileStats.birthtime && fileStats.birthtime.getTime() > 0) {
    return fileStats.birthtime;
  }

  // Fallback to changetime
  if (fileStats.ctime && fileStats.ctime.getTime() > 0) {
    return fileStats.ctime;
  }

  // Fallback to modified time
  if (fileStats.mtime && fileStats.mtime.getTime() > 0) {
    return fileStats.mtime;
  }

  // Fallback to filename parsing
  // format is 4digits-2digis-2digits(' ' or '_' or 'T')
  // 2digits('-' or ':')2digits('-' or ':')2digits
  const regexp = /(\d{4})-(\d{2})-(\d{2})[ _T](\d{2})[-:](\d{2})[-:](\d{2})/;
  const matches = fileName.match(regexp);
  if (!matches)
    return null;

  // Verify that each regex match is a valid number
  for (var i=1; i<7; i++) {
    if (Number.isNaN(Number(matches[i])))
      return null;
  }

  return new Date(matches[1], matches[2]-1, matches[3], matches[4], matches[5], matches[6]);
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function getTableColumns(pool, tableName) {
  const { rows } = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [tableName]
  );

  return new Set(rows.map((row) => row.column_name));
}

function getBackupTableEntry(table) {
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    return null;
  }

  const keys = Object.keys(table);
  if (keys.length !== 1) {
    return null;
  }

  const tableName = keys[0];
  const data = table[tableName];

  if (!Array.isArray(data)) {
    return null;
  }

  return { tableName, data };
}

const RESTORE_BATCH_SIZE = Number(process.env.RESTORE_BATCH_SIZE || 500);

function normalizeRestoreValue(value) {
  return value && typeof value === "object" ? JSON.stringify(value) : value;
}

async function insertRestoreRows(pool, tableName, tableColumns, data, skippedColumns) {
  let restoredRows = 0;
  const validRows = [];
  const usedColumns = new Set();

  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }

    const rowKeys = Object.keys(row);
    const filteredKeys = rowKeys.filter((key) => tableColumns.has(key));
    const ignoredKeys = rowKeys.filter((key) => !tableColumns.has(key));

    if (ignoredKeys.length > 0) {
      skippedColumns[tableName] = Array.from(new Set([...(skippedColumns[tableName] || []), ...ignoredKeys]));
    }

    if (filteredKeys.length === 0) {
      continue;
    }

    filteredKeys.forEach((key) => usedColumns.add(key));
    validRows.push(row);
  }

  if (validRows.length === 0) {
    return 0;
  }

  const keys = [...usedColumns].sort();
  const keyString = keys.map(quoteIdentifier).join(", ");
  // App config is a single-row table; always replace so auth/settings come back on restore.
  const conflictClause =
    tableName === "app_config"
      ? `ON CONFLICT ("ID") DO UPDATE SET ${keys
          .filter((key) => key !== "ID")
          .map((key) => `${quoteIdentifier(key)} = EXCLUDED.${quoteIdentifier(key)}`)
          .join(", ")}`
      : "ON CONFLICT DO NOTHING";

  for (let offset = 0; offset < validRows.length; offset += RESTORE_BATCH_SIZE) {
    const batch = validRows.slice(offset, offset + RESTORE_BATCH_SIZE);
    const values = [];
    let paramIndex = 1;
    const rowPlaceholders = batch.map((row) => {
      const placeholders = keys.map((key) => {
        values.push(Object.prototype.hasOwnProperty.call(row, key) ? normalizeRestoreValue(row[key]) : null);
        return `$${paramIndex++}`;
      });
      return `(${placeholders.join(", ")})`;
    });

    const query = `INSERT INTO ${quoteIdentifier(tableName)} (${keyString}) VALUES ${rowPlaceholders.join(", ")} ${conflictClause}`;
    const result = await pool.query(query, values);
    restoredRows += result.rowCount;
  }

  return restoredRows;
}

async function restore(file, refLog, options = {}) {
  const deferViewRefresh = options.deferViewRefresh === true;
  refLog.logData.push({ color: "lawngreen", Message: "Starting Restore" });
  refLog.logData.push({
    color: "yellow",
    Message: "Restoring from Backup: " + file,
  });

  let jsonData;

  try {
    jsonData = await readFile(file);
  } catch (err) {
    refLog.logData.push({
      color: "red",
      Message: `Failed to read backup file`,
    });
    Logging.updateLog(refLog.uuid, refLog.logData, taskstate.FAILED);
    console.error(err);
    if (err instanceof SyntaxError) {
      throw new Error("Backup file is not valid JSON. Re-export the backup or upload a complete .json file.");
    }
    throw err;
  }

  // console.log(jsonData);
  if (!jsonData) {
    console.log("No Data");
    return;
  }

  if (!Array.isArray(jsonData)) {
    throw new Error("Backup file must be a JSON array of table exports");
  }

  const restoredTables = [];
  const skippedTables = [];
  const skippedColumns = {};
  let restoredRows = 0;

  const pool = new Pool({
    user: postgresUser,
    password: postgresPassword,
    host: postgresIp,
    port: postgresPort,
    database: postgresDatabase,
    ...(process.env.POSTGRES_SSL_ENABLED === "true"
      ? { ssl: { rejectUnauthorized: postgresSslRejectUnauthorized } }
      : {}),
  });

  try {
    for (let table of jsonData) {
      const tableEntry = getBackupTableEntry(table);

      if (!tableEntry) {
        refLog.logData.push({
          color: "yellow",
          Message: "Skipping invalid backup table entry",
        });
        continue;
      }

      const { data, tableName } = tableEntry;

      if (!restorableTables.has(tableName)) {
        skippedTables.push(tableName);
        refLog.logData.push({
          color: "yellow",
          key: tableName,
          Message: `Skipping unsupported table ${tableName}`,
        });
        continue;
      }

      const tableColumns = await getTableColumns(pool, tableName);
      restoredTables.push(tableName);
      refLog.logData.push({
        color: "dodgerblue",
        key: tableName,
        Message: `Restoring ${tableName} (${data.length.toLocaleString()} rows)`,
      });
      console.log(`[BACKUP] Restoring ${tableName} (${data.length.toLocaleString()} rows)...`);
      const tableStartedAt = Date.now();
      restoredRows += await insertRestoreRows(pool, tableName, tableColumns, data, skippedColumns);
      console.log(`[BACKUP] Finished ${tableName} in ${((Date.now() - tableStartedAt) / 1000).toFixed(1)}s`);
    }

    if (deferViewRefresh) {
      db.scheduleMaterializedViewRefreshes();
      refLog.logData.push({
        color: "yellow",
        Message: "Scheduled materialized view refresh in background",
      });
    } else {
      for (const view of db.materializedViews) {
        const refresh = await db.refreshMaterializedView(view);
        refLog.logData.push({
          color: refresh.Result === "SUCCESS" ? "lawngreen" : "red",
          Message: refresh.message,
        });
      }
    }

    if (!restoredTables.includes("app_config")) {
      refLog.logData.push({
        color: "yellow",
        Message: "Backup did not include app_config. Auth method was not restored — finish setup or re-save authentication.",
      });
      console.warn("[BACKUP] Restore finished without app_config; auth method was not restored");
    }

    refLog.logData.push({ color: "lawngreen", Message: "Restore Complete" });

    return {
      restoredRows,
      restoredTables,
      skippedTables,
      skippedColumns,
      refreshedViews: db.materializedViews,
    };
  } finally {
    await pool.end();
  }
}

function createPool() {
  return new Pool({
    user: postgresUser,
    password: postgresPassword,
    host: postgresIp,
    port: postgresPort,
    database: postgresDatabase,
    ...(process.env.POSTGRES_SSL_ENABLED === "true"
      ? { ssl: { rejectUnauthorized: postgresSslRejectUnauthorized } }
      : {}),
  });
}

async function clearRestorableTables(pool) {
  for (const tableName of restorableTables) {
    const columns = await getTableColumns(pool, tableName);
    if (!columns.size) continue;
    await pool.query(`TRUNCATE TABLE ${quoteIdentifier(tableName)} CASCADE`);
  }
}

async function assertFirstRunAvailable() {
  const config = await new configClass().getConfig();
  if (config.state != null && config.state >= 2) {
    const error = new Error("Setup is already complete. Sign in instead, or restore backups from Settings > Backups.");
    error.statusCode = 403;
    throw error;
  }
}

const firstRunRestoreStatus = {
  status: "idle",
  setupState: null,
  restoredRows: 0,
  error: null,
  updatedAt: null,
};

function setFirstRunRestoreStatus(nextStatus) {
  Object.assign(firstRunRestoreStatus, nextStatus, { updatedAt: new Date().toISOString() });
}

function getFirstRunRestoreStatusHandler(req, res) {
  res.json(firstRunRestoreStatus);
}

async function runFirstRunRestore(filePath) {
  const uuid = randomUUID();
  const refLog = { logData: [], uuid };
  Logging.insertLog(uuid, triggertype.Manual, taskName.restore);

  const pool = createPool();
  try {
    await clearRestorableTables(pool);
    refLog.logData.push({ color: "yellow", Message: "Cleared existing tables for first-run restore" });
  } finally {
    await pool.end();
  }

  try {
    const restoreResult = await restore(filePath, refLog, { deferViewRefresh: true });
    Logging.updateLog(uuid, refLog.logData, taskstate.SUCCESS);
    const config = await new configClass().getConfig();
    return {
      ...restoreResult,
      setupState: config.state ?? 0,
      message: "Restore completed successfully",
    };
  } catch (error) {
    refLog.logData.push({ color: "red", Message: `Restore failed: ${error.message}` });
    Logging.updateLog(uuid, refLog.logData, taskstate.FAILED);
    throw error;
  }
}

// Route handler for backup endpoint
router.get("/beginBackup", async (req, res) => {
  try {
    const taskManager = new TaskManager().getInstance();
    const taskScheduler = new TaskScheduler().getInstance();
    const success = taskManager.addTask({
      task: taskManager.taskList.Backup,
      onComplete: async () => {
        console.log("Backup completed successfully");
        await taskScheduler.getTaskHistory();
        res.send("Backup completed successfully");
        sendUpdate("BackupTask", { type: "Success", message: "Manual Backup completed", triggerType: triggertype.Manual, taskName: taskName.backup });
      },
      onError: (error) => {
        console.error(error);
        res.status(500).send("Backup failed");
        sendUpdate("BackupTask", { type: "Error", message: "Error: Backup failed", triggerType: triggertype.Manual, taskName: taskName.backup });
      },
    });
    if (!success) {
      res.status(500).send("Backup already running");
      sendUpdate("BackupTask", { type: "Error", message: "Backup is already running", triggerType: triggertype.Manual, taskName: taskName.backup });
      return;
    }

    taskManager.startTask(taskManager.taskList.Backup, triggertype.Manual);
    sendUpdate("BackupTask", { type: "Start", message: "Manual Backup started", triggerType: triggertype.Manual, taskName: taskName.backup });
  } catch (error) {
    console.error(error);
    res.status(500).send("Backup failed");
  }
});

router.get("/restore/:filename", async (req, res) => {
  const uuid = randomUUID();
  let refLog = { logData: [], uuid: uuid };

  try {
    Logging.insertLog(uuid, triggertype.Manual, taskName.restore);

    const filename = sanitizeFilename(req.params.filename);
    const filePath = path.join(getBackupDir(), filename);

    const pool = createPool();
    try {
      await clearRestorableTables(pool);
      refLog.logData.push({ color: "yellow", Message: "Cleared existing tables before restore" });
    } finally {
      await pool.end();
    }

    const restoreResult = await restore(filePath, refLog, { deferViewRefresh: true });
    Logging.updateLog(uuid, refLog.logData, taskstate.SUCCESS);
    await addAuditEntry(req, "backup.restored", { filename, restoredRows: restoreResult?.restoredRows || 0 });

    const config = await new configClass().getConfig();
    res.json({
      message: "Restore completed successfully",
      setupState: config.state ?? 0,
      ...restoreResult,
    });
    sendUpdate("GeneralAlert", { type: "Success", message: "Restore completed successfully. Dashboard data refreshed.", triggerType: triggertype.Manual, taskName: taskName.restore });
    sendUpdate("BackupRestore", { type: "Success", message: "Restore completed successfully", triggerType: triggertype.Manual, taskName: taskName.restore, setupState: config.state ?? 0, ...restoreResult });
  } catch (error) {
    console.error(error);
    refLog.logData.push({ color: "red", Message: `Restore failed: ${error.message}` });
    Logging.updateLog(uuid, refLog.logData, taskstate.FAILED);
    res.status(500).send(error.message || "Restore failed");
  }
});

router.get("/files", (req, res) => {
  try {
    const directoryPath = getBackupDir();
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
    fs.readdir(directoryPath, (err, files) => {
      if (err) {
        res.status(500).send("Unable to read directory");
      } else {
        const fileData = files
          .filter((file) => file.endsWith(".json"))
          .map((file) => {
            const filePath = path.join(directoryPath, file);
            const stats = fs.statSync(filePath);
            return {
              name: file,
              size: stats.size,
              datecreated: getBirthtimeFallback(stats, file),
            };
          });
        res.json(fileData);
      }
    });
  } catch (error) {
    console.log(error);
  }
});

router.get("/summary", (req, res) => {
  try {
    const directoryPath = getBackupDir();
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }

    fs.readdir(directoryPath, (err, files) => {
      if (err) {
        res.status(500).send("Unable to read directory");
        return;
      }

      const backupFiles = files
        .filter((file) => file.endsWith(".json"))
        .map((file) => {
          const filePath = path.join(directoryPath, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            size: stats.size,
            datecreated: getBirthtimeFallback(stats, file),
          };
        })
        .sort((a, b) => new Date(b.datecreated) - new Date(a.datecreated));

      res.json({
        count: backupFiles.length,
        latestBackup: backupFiles[0] || null,
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Unable to read backup summary");
  }
});

router.get("/files/:filename/ticket", (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const filePath = path.join(getBackupDir(), filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).send("Backup file not found");
      return;
    }

    const ticket = jwt.sign(
      {
        purpose: "backup-download",
        filename,
      },
      jwtSecret,
      { expiresIn: "2m" }
    );

    res.json({
      url: `/backup-download/${encodeURIComponent(filename)}?ticket=${encodeURIComponent(ticket)}`,
      expiresInSeconds: 120,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Unable to create backup download link");
  }
});

//download backup file
router.get("/files/:filename", (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const filePath = path.join(getBackupDir(), filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).send("Backup file not found");
      return;
    }

    res.download(filePath, filename, (error) => {
      if (error && !res.headersSent) {
        console.error(error);
        res.status(500).send("Unable to download backup file");
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Unable to download backup file");
  }
});

//delete backup
router.delete("/files/:filename", (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const filePath = path.join(getBackupDir(), filename);

    fs.unlink(filePath, (err) => {
      if (err) {
        console.error(err);
        res.status(500).send("An error occurred while deleting the file.");
        return;
      }

      console.log(`${filePath} has been deleted.`);
      res.status(200).send(`${filePath} has been deleted.`);
    });
  } catch (error) {
    res.status(500).send("An error occurred while deleting the file.");
  }
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const destination = getBackupDir();
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(destination, { recursive: true });
    }
    cb(null, destination);
  },
  filename: function (req, file, cb) {
    cb(null, sanitizeFilename(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    const safeName = sanitizeFilename(file.originalname);
    if (!safeName.endsWith(".json")) {
      cb(new Error("Only JSON backup files can be uploaded"));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 1024 * 1024 * 512 },
});

router.post("/upload", (req, res) => {
  upload.single("file")(req, res, (error) => {
    if (error) {
      res.status(400).send(error.message);
      return;
    }

    if (!req.file) {
      res.status(400).send("No backup file uploaded");
      return;
    }

    res.json({
      fileName: req.file.filename,
      filePath: req.file.path,
    });
  });
});


// First-run restores must never land in the live backup directory before we know
// setup is still open (GHSA-pjwm-mr57-hjv4). Temp + random name, then unlink on failure.
const firstRunTempDir = path.join(os.tmpdir(), "jellyglance-first-run");
const firstRunStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(firstRunTempDir)) {
      fs.mkdirSync(firstRunTempDir, { recursive: true });
    }
    cb(null, firstRunTempDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${randomUUID()}.json`);
  },
});

const firstRunUpload = multer({
  storage: firstRunStorage,
  fileFilter: function (req, file, cb) {
    const safeName = sanitizeFilename(file.originalname);
    if (!safeName.endsWith(".json")) {
      cb(new Error("Only JSON backup files can be uploaded"));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 1024 * 1024 * 512 },
});

const discardFirstRunUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 512 },
});

function unlinkQuietly(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}

async function firstRunRestoreHandler(req, res) {
  let setupOpen = true;
  let setupError = null;
  try {
    await assertFirstRunAvailable();
  } catch (error) {
    setupOpen = false;
    setupError = error;
  }

  // If setup is already complete, consume the multipart body in memory only so
  // nothing is written under the backup directory, then return 403.
  const uploader = setupOpen ? firstRunUpload : discardFirstRunUpload;

  uploader.single("file")(req, res, async (error) => {
    if (!setupOpen) {
      res.status(setupError?.statusCode || 403).json({
        error: setupError?.message || "Setup is already complete",
      });
      return;
    }

    if (error) {
      unlinkQuietly(req.file?.path);
      const message = /boundary not found/i.test(error.message)
        ? "Upload failed. Try choosing the backup file again."
        : error.message;
      res.status(400).json({ error: message });
      return;
    }

    try {
      // Re-check after the upload in case setup finished while the file was in flight.
      await assertFirstRunAvailable();

      if (!req.file) {
        res.status(400).json({ error: "No backup file received. Choose a .json backup file and try again." });
        return;
      }

      const filePath = req.file.path;
      const filename = req.file.filename;

      setFirstRunRestoreStatus({
        status: "running",
        setupState: null,
        restoredRows: 0,
        error: null,
      });

      res.status(202).json({
        status: "processing",
        message: "Backup uploaded. Restore is running in the background.",
        filename,
      });

      runFirstRunRestore(filePath)
        .then(async (restoreResult) => {
          unlinkQuietly(filePath);
          setFirstRunRestoreStatus({
            status: "complete",
            setupState: restoreResult?.setupState ?? 0,
            restoredRows: restoreResult?.restoredRows || 0,
            error: null,
          });
          await addAuditEntry(req, "backup.first_run_restored", {
            filename,
            restoredRows: restoreResult?.restoredRows || 0,
            setupState: restoreResult?.setupState,
          }).catch(() => {});

          sendUpdate("BackupRestore", {
            type: "Success",
            message: "First-run restore completed successfully",
            triggerType: triggertype.Manual,
            taskName: taskName.restore,
            ...restoreResult,
          });
        })
        .catch((restoreError) => {
          unlinkQuietly(filePath);
          console.error("[BACKUP] First-run restore failed:", restoreError);
          setFirstRunRestoreStatus({
            status: "failed",
            setupState: null,
            restoredRows: 0,
            error: restoreError.message || "Restore failed",
          });
          sendUpdate("BackupRestore", {
            type: "Error",
            message: restoreError.message || "Restore failed",
            triggerType: triggertype.Manual,
            taskName: taskName.restore,
          });
        });
    } catch (restoreError) {
      unlinkQuietly(req.file?.path);
      console.error("[BACKUP] First-run restore failed:", restoreError);
      res.status(restoreError.statusCode || 500).json({
        error: restoreError.message || "Restore failed",
      });
    }
  });
}

// Handle other routes
router.use((req, res) => {
  res.status(404).send({ error: "Not Found" });
});

module.exports = router;
module.exports.firstRunRestoreHandler = firstRunRestoreHandler;
module.exports.getFirstRunRestoreStatusHandler = getFirstRunRestoreStatusHandler;
module.exports.runFirstRunRestore = runFirstRunRestore;
