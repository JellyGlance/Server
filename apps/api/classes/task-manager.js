const timers = require("./timers");
const { Worker } = require("worker_threads");
const TaskList = require("../global/task-list");
const { sendUpdate } = require("../ws");
const taskstate = require("../logging/taskstate");
const db = require("../db");
const WebhookManager = require("./webhook-manager");

const DOMAIN_EVENT_TASKS = new Set([
  "Download Queue Sync",
  "Arr Calendar Sync",
  "Invite Sync",
  "Integration Sync",
]);

class TaskManager {
  constructor() {
    this.tasks = {};
    this.taskList = TaskList;
    this.emitTaskList();
  }

  async notifyTaskWebhook(eventType, task, extra = {}) {
    try {
      if ((eventType === "task_started" || eventType === "task_completed") && DOMAIN_EVENT_TASKS.has(task.name)) {
        return;
      }
      const webhookManager = new WebhookManager();
      await webhookManager.triggerEventWebhooks(eventType, {
        taskName: task.name,
        taskKey: Object.keys(this.taskList).find((key) => this.taskList[key].name === task.name),
        ...extra,
      });
    } catch (error) {
      console.log(`Task webhook notification failed: ${error.message}`);
    }
  }

  addTask({ task, onComplete, onError, onExit, onSkip }) {
    if (this.tasks[task.name]) {
      console.log(`Task ${task.name} already exists.`);
      return false;
    }

    const worker = new Worker(task.path);

    worker.on("message", (message) => {
      if (message.type === "log") {
        // Handle console.log messages
        console.log(`[Worker Log]: ${message.message}`);
      }
      if (message.status === "complete" && onComplete) {
        this.notifyTaskWebhook("task_completed", task, { status: "completed" });
        onComplete();
      }
      if (message.status === "skipped") {
        db.query(`UPDATE jf_logging SET "Result"=$1 WHERE "Result"=$2 AND "Name"=$3`, [taskstate.SKIPPED, taskstate.RUNNING, task.name]).catch(
          (error) => console.log("Mark Skipped Task Error: " + error)
        );
        if (onSkip) {
          onSkip(message);
        }
      }
      if (message.status === "error" && onError) {
        this.notifyTaskWebhook("task_failed", task, { status: "failed", error: message.message });
        onError(new Error(message.message));
      }
      delete this.tasks[task.name];
    });

    worker.on("error", (error) => {
      if (onError) {
        this.notifyTaskWebhook("task_failed", task, { status: "failed", error: error.message });
        onError(error);
      }
      console.error(`Error from ${task.name}:`, error);
      delete this.tasks[task.name];
    });

    worker.on("exit", async (code) => {
      if (code !== 0) {
        console.error(`Worker ${task.name} stopped with exit code ${code}`);
      }
      if (code !== 0 && onExit) {
        this.notifyTaskWebhook("task_failed", task, { status: "stopped", exitCode: code });
        onExit();
      }
      delete this.tasks[task.name];
      try {
        await db.query(
          `UPDATE jf_logging SET "Result"='${taskstate.FAILED}' WHERE "Result"='${taskstate.RUNNING}' AND "Name"='${task.name}'`
        );
      } catch (error) {
        console.log("Clear Running Tasks Error: " + error);
      }
    });

    this.tasks[task.name] = { worker };
    return true;
  }

  startTask(task, triggerType) {
    const taskExists = this.tasks[task.name];
    if (!taskExists) {
      console.log(`Task ${task.name} does not exist.`);
      return;
    }
    this.notifyTaskWebhook("task_started", task, { status: "started", triggerType });
    taskExists.worker.postMessage({ command: "start", triggertype: triggerType });
  }

  stopTask(task) {
    const taskExists = this.tasks[task.name];
    if (!taskExists) {
      console.log(`Task ${task.name} does not exist.`);
      return;
    }

    taskExists.worker.terminate();
    delete this.tasks[task.name];
  }

  isTaskRunning(taskName) {
    return !!this.tasks[taskName];
  }

  emitTaskList() {
    timers.clear(this.emitTasksTimer);
    this.emitTasksTimer = timers.every(async () => {
      const taskList = Object.keys(this.taskList).map((key) => {
        return { task: key, name: this.taskList[key].name, running: this.isTaskRunning(this.taskList[key].name) };
      });
      sendUpdate("task-list", taskList);
    }, 1000);
  }

  stop() {
    timers.clear(this.emitTasksTimer);
    this.emitTasksTimer = null;
  }
}

module.exports = TaskManager;
