const db = require("../db");
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("crypto");

const defaultIntegrations = {
  arrApps: [],
  clients: [],
  thirdParty: [],
};

const defaultData = {
  calendar: {
    releases: [],
    sources: [],
    syncedAt: null,
  },
  downloads: {
    items: [],
    clients: [],
    syncedAt: null,
  },
  invites: {
    sources: [],
    items: [],
    syncedAt: null,
  },
  autobrr: {
    hits: [],
    syncedAt: null,
  },
};

const maxHealthHistoryEntries = 50;
const encryptedSecretPrefix = "jgenc:v1:";

function getEncryptionKey() {
  const secret = process.env.INTEGRATION_SECRET_KEY || process.env.JWT_SECRET;
  if (!secret) {
    return null;
  }

  return createHash("sha256").update(secret).digest();
}

function encryptSecret(secret) {
  if (!secret || typeof secret !== "string" || secret.startsWith(encryptedSecretPrefix)) {
    return secret;
  }

  const key = getEncryptionKey();
  if (!key) {
    return secret;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${encryptedSecretPrefix}${Buffer.concat([iv, authTag, encrypted]).toString("base64")}`;
}

function decryptSecret(secret) {
  if (!secret || typeof secret !== "string" || !secret.startsWith(encryptedSecretPrefix)) {
    return secret;
  }

  const key = getEncryptionKey();
  if (!key) {
    return "";
  }

  try {
    const payload = Buffer.from(secret.slice(encryptedSecretPrefix.length), "base64");
    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (error) {
    console.error("Unable to decrypt integration secret:", error.message);
    return "";
  }
}

function mapIntegrationSecrets(integrations, mapper) {
  return {
    ...defaultIntegrations,
    ...(integrations || {}),
    arrApps: (integrations?.arrApps || []).map((integration) => ({
      ...integration,
      values: {
        ...(integration.values || {}),
        secret: mapper(integration.values?.secret),
      },
    })),
    clients: (integrations?.clients || []).map((integration) => ({
      ...integration,
      values: {
        ...(integration.values || {}),
        secret: mapper(integration.values?.secret),
      },
    })),
    thirdParty: (integrations?.thirdParty || []).map((integration) => ({
      ...integration,
      values: {
        ...(integration.values || {}),
        secret: mapper(integration.values?.secret),
      },
    })),
  };
}

async function getSettings() {
  const rows = await db.query('SELECT settings FROM app_config where "ID"=1').then((res) => res.rows);
  const settings = rows[0]?.settings || {};
  return settings;
}

async function saveSettings(settings) {
  await db.query(
    `
      UPDATE app_config
      SET settings = (COALESCE(settings, '{}'::json)::jsonb || $1::jsonb)::json
      WHERE "ID" = 1
    `,
    [settings]
  );
}

async function getIntegrations() {
  const settings = await getSettings();
  const integrations = {
    ...defaultIntegrations,
    ...(settings.Integrations || {}),
  };
  return mapIntegrationSecrets(integrations, decryptSecret);
}

async function saveIntegrations(integrations) {
  const settings = await getSettings();
  const currentIntegrations = {
    ...defaultIntegrations,
    ...(settings.Integrations || {}),
  };
  const nextIntegrations = {
    ...defaultIntegrations,
    ...(integrations || {}),
  };

  // Settings saves submit all integrations together. Preserve an existing
  // secret when a form that edits another integration sends it back blank.
  for (const listName of ["arrApps", "clients", "thirdParty"]) {
    const currentList = Array.isArray(currentIntegrations[listName]) ? currentIntegrations[listName] : [];
    nextIntegrations[listName] = (Array.isArray(nextIntegrations[listName]) ? nextIntegrations[listName] : []).map((integration) => {
      const current = currentList.find(
        (candidate) => candidate.instanceId === integration.instanceId || candidate.slug === integration.slug
      );
      const incomingSecret = integration.values?.secret;
      if (incomingSecret || !current?.values?.secret) return integration;

      return {
        ...integration,
        values: {
          ...(integration.values || {}),
          secret: current.values.secret,
        },
      };
    });
  }

  const savedIntegrations = mapIntegrationSecrets(
    nextIntegrations,
    encryptSecret
  );
  await saveSettings({ Integrations: savedIntegrations });
  return mapIntegrationSecrets(savedIntegrations, decryptSecret);
}

async function getIntegrationData() {
  const settings = await getSettings();
  return {
    calendar: {
      ...defaultData.calendar,
      ...(settings.IntegrationData?.calendar || {}),
    },
    downloads: {
      ...defaultData.downloads,
      ...(settings.IntegrationData?.downloads || {}),
    },
    invites: {
      ...defaultData.invites,
      ...(settings.IntegrationData?.invites || {}),
    },
    autobrr: {
      hits: [],
      syncedAt: null,
      ...(settings.IntegrationData?.autobrr || {}),
    },
    cleanuparr: {
      events: [],
      handled: {},
      lastEventAt: null,
      ...(settings.IntegrationData?.cleanuparr || {}),
    },
  };
}

async function saveIntegrationData(partialData) {
  const settings = await getSettings();
  const integrationData = {
    ...defaultData,
    ...(settings.IntegrationData || {}),
    ...(partialData || {}),
  };
  await saveSettings({ IntegrationData: integrationData });
  return integrationData;
}

async function getIntegrationHealthHistory() {
  const settings = await getSettings();
  return Array.isArray(settings.IntegrationHealthHistory) ? settings.IntegrationHealthHistory : [];
}

async function saveIntegrationHealthResults(results = []) {
  const settings = await getSettings();
  const currentHistory = Array.isArray(settings.IntegrationHealthHistory) ? settings.IntegrationHealthHistory : [];
  const historyEntries = results.map((result) => ({
    ...result,
    checkedAt: result.checkedAt || new Date().toISOString(),
  }));
  const nextHistory = [...historyEntries, ...currentHistory].slice(0, maxHealthHistoryEntries);
  await saveSettings({ IntegrationHealthHistory: nextHistory });
  return nextHistory;
}

module.exports = {
  getIntegrations,
  saveIntegrations,
  getIntegrationData,
  saveIntegrationData,
  getIntegrationHealthHistory,
  saveIntegrationHealthResults,
  encryptSecret,
  decryptSecret,
};
