// Outbound webhook rules: storage, delivery log and the hook the webhook event bus calls.
// Rule URLs and header values can hold tokens, so they are encrypted at rest and masked for the browser.
const { getSettings, mergeSettings } = require("./admin-history");
const { encryptSecret, decryptSecret } = require("./integration-store");
const { assertDeliverableUrl } = require("./alert-actions");
const rulesLib = require("./webhook-out-rules");

const TIMEOUT_MS = 8000;
const lastFired = new Map();

function safeDecrypt(value) {
  try {
    return value ? decryptSecret(value) : "";
  } catch {
    return "";
  }
}

function decodeRule(stored = {}) {
  let headers = {};
  try {
    headers = JSON.parse(safeDecrypt(stored.headersSecret) || "{}");
  } catch {
    headers = {};
  }
  return rulesLib.normalizeRule({ ...stored, url: safeDecrypt(stored.urlSecret), headers });
}

async function loadRules() {
  const settings = await getSettings();
  return (Array.isArray(settings.WebhookOutRules) ? settings.WebhookOutRules : []).map(decodeRule);
}

async function getLog() {
  const settings = await getSettings();
  return Array.isArray(settings.WebhookOutLog) ? settings.WebhookOutLog : [];
}

function maskRule(rule) {
  return {
    ...rule,
    url: "",
    urlHint: rulesLib.maskUrl(rule.url),
    hasUrl: Boolean(rule.url),
    headers: Object.keys(rule.headers || {}).map((name) => ({ name, value: "", hasValue: Boolean(rule.headers[name]) })),
  };
}

// Blank URL / header values from the browser mean "keep what is saved".
function mergeSecrets(incoming = [], saved = []) {
  const byId = new Map(saved.map((rule) => [rule.id, rule]));
  return (Array.isArray(incoming) ? incoming : []).slice(0, rulesLib.MAX_RULES).map((raw, index) => {
    const previous = byId.get(String(raw?.id || ""));
    const rows = Array.isArray(raw?.headers) ? raw.headers : Object.entries(raw?.headers || {}).map(([name, value]) => ({ name, value }));
    const headers = {};
    for (const row of rows) {
      const name = String(row?.name || "").trim();
      if (!name) continue;
      headers[name] = row.value ? String(row.value) : previous?.headers?.[name] || "";
    }
    return rulesLib.normalizeRule({ ...raw, url: raw?.url || previous?.url || "", headers }, index);
  });
}

async function saveRules(incoming) {
  const merged = mergeSecrets(incoming, await loadRules());
  for (const rule of merged) {
    if (rule.url) await assertDeliverableUrl(rule.url);
    if (rule.bodyTemplate) rulesLib.buildRequest(rule, rulesLib.buildContext("test", rulesLib.sampleData(rule.trigger), rule.trigger));
  }
  const stored = merged.map(({ url, headers, ...rest }) => ({
    ...rest,
    urlSecret: url ? encryptSecret(url) : "",
    headersSecret: Object.keys(headers).length ? encryptSecret(JSON.stringify(headers)) : "",
  }));
  await mergeSettings({ WebhookOutRules: stored });
  return merged;
}

async function appendLog(entries) {
  if (!entries.length) return;
  const log = await getLog();
  await mergeSettings({ WebhookOutLog: [...entries, ...log].slice(0, rulesLib.MAX_LOG) });
}

async function send(rule, context, { http } = {}) {
  const started = Date.now();
  const entry = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ruleId: rule.id, ruleName: rule.name, trigger: rule.trigger, format: rule.format, test: Boolean(context.data?.test), title: context.title, at: new Date().toISOString() };
  try {
    const request = rulesLib.buildRequest(rule, context);
    await assertDeliverableUrl(request.url);
    const client = http || require("./axios").axios;
    const response = await client.request({ method: "post", url: request.url, data: request.body, headers: request.headers, timeout: TIMEOUT_MS, maxRedirects: 0 });
    return { ...entry, ok: true, status: response?.status || 200, ms: Date.now() - started };
  } catch (error) {
    // Never log the URL: it may carry a token.
    return { ...entry, ok: false, status: error.response?.status || null, error: error.response ? `HTTP ${error.response.status}` : String(error.message || error).slice(0, 200), ms: Date.now() - started };
  }
}

// Called for every event on the webhook bus. Never throws.
async function dispatch(eventType, data = {}, options = {}) {
  try {
    const rules = rulesLib.rulesFor(await loadRules(), eventType, data);
    if (!rules.length) return [];
    const now = Date.now();
    const due = rules.filter((rule) => {
      const last = lastFired.get(rule.id) || 0;
      if (rule.cooldownMinutes && now - last < rule.cooldownMinutes * 60000) return false;
      lastFired.set(rule.id, now);
      return true;
    });
    const results = await Promise.all(due.map((rule) => send(rule, rulesLib.buildContext(eventType, data, rule.trigger), options)));
    await appendLog(results);
    return results;
  } catch (error) {
    console.error("[WEBHOOK-OUT] Dispatch failed:", error.message);
    return [];
  }
}

async function testRule(ruleId, draft = null, options = {}) {
  const saved = await loadRules();
  const base = saved.find((rule) => rule.id === ruleId);
  const rule = draft ? mergeSecrets([{ ...draft, id: ruleId }], saved)[0] : base;
  if (!rule) throw Object.assign(new Error("Rule not found"), { status: 404 });
  if (!rule.url) throw Object.assign(new Error("Add a destination URL first"), { status: 400 });
  const data = rulesLib.sampleData(rule.trigger);
  const result = await send(rule, rulesLib.buildContext(data.event, data, rule.trigger), options);
  await appendLog([result]);
  return result;
}

function preview(rawRule) {
  const rule = rulesLib.normalizeRule({ ...rawRule, url: rawRule?.url || "https://example.invalid/hook" });
  const data = rulesLib.sampleData(rule.trigger);
  const request = rulesLib.buildRequest(rule, rulesLib.buildContext(data.event, data, rule.trigger));
  return { body: request.body };
}

module.exports = { dispatch, getLog, loadRules, maskRule, mergeSecrets, preview, saveRules, send, testRule };
