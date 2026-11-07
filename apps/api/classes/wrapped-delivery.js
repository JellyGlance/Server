// Scheduled Wrapped recaps: each subscription sends one user's last finished week or month by
// email (through the newsletter SMTP settings) and/or to one of the configured webhooks. The
// WrappedRecaps task runs hourly and only sends a period once, so restarts never double-send.
const { randomUUID } = require("crypto");
const db = require("../db");
const { getSettings, mergeSettings } = require("./admin-history");
const { isValidEmail } = require("../utils/security");

const SETTINGS_KEY = "WrappedDelivery";
const PERIODS = ["week", "month"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MAX_SUBSCRIPTIONS = 500;

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// First day of the last *finished* week (Monday based, like Postgres date_trunc) or month.
function lastFinishedPeriodStart(period, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "month") return isoDate(new Date(date.getFullYear(), date.getMonth() - 1, 1));
  const sinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - sinceMonday - 7);
  return isoDate(date);
}

function hoursText(seconds) {
  const value = Number(seconds || 0) / 3600;
  return value >= 100 ? Math.round(value).toLocaleString("en-GB") : value.toFixed(1);
}

function dayText(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return String(iso || "");
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]}`;
}

function periodLabel(data) {
  if (data.period === "month") {
    const [y, m] = data.start.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  return `week of ${dayText(data.start)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

// Plain summary used by email, webhooks and the preview in the UI.
function formatRecap(data) {
  const who = data.userName || "Everyone";
  const totals = data.totals || {};
  const plays = Number(totals.plays || 0);
  const title = `${who}'s Wrapped: ${periodLabel(data)}`;
  const shows = (data.topShows || []).slice(0, 5).map((row, index) => `${index + 1}. ${row.name} (${hoursText(row.seconds)} h)`);
  const movies = (data.topMovies || []).slice(0, 3).map((row, index) => `${index + 1}. ${row.name} (${hoursText(row.seconds)} h)`);
  const busiest = data.busiestDay ? `${dayText(data.busiestDay.day instanceof Date ? isoDate(data.busiestDay.day) : data.busiestDay.day)} (${hoursText(data.busiestDay.seconds)} h)` : null;
  const lines = plays
    ? [
        `${hoursText(totals.seconds)} hours watched across ${plays} play${plays === 1 ? "" : "s"} and ${Number(totals.titles || 0)} title${Number(totals.titles) === 1 ? "" : "s"}.`,
        busiest ? `Busiest day: ${busiest}.` : null,
        shows.length ? `Top shows:\n${shows.join("\n")}` : null,
        movies.length ? `Top movies:\n${movies.join("\n")}` : null,
      ].filter(Boolean)
    : ["Nothing was watched in this period."];
  const message = lines.join("\n\n");
  const listHtml = (heading, rows) => (rows.length ? `<h3 style="margin:18px 0 6px">${heading}</h3><ol style="margin:0;padding-left:20px">${rows.map((row) => `<li>${escapeHtml(row.replace(/^\d+\.\s/, ""))}</li>`).join("")}</ol>` : "");
  const html = `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#e8ecf4;background:#0b0d12;padding:24px;border-radius:14px">
<h2 style="margin:0 0 4px">${escapeHtml(title)}</h2>
<p style="margin:0 0 16px;color:#8a97ad">${escapeHtml(data.start)} to ${escapeHtml(data.end)}</p>
${plays ? `<p style="font-size:18px;margin:0">${escapeHtml(lines[0])}</p>${busiest ? `<p>Busiest day: <strong>${escapeHtml(busiest)}</strong></p>` : ""}${listHtml("Top shows", shows)}${listHtml("Top movies", movies)}` : "<p>Nothing was watched in this period.</p>"}
<p style="margin-top:18px"><img src="cid:wrapped-card" alt="Recap card" style="width:100%;border-radius:10px"/></p>
</div>`;
  return { title, message, text: `${title}\n${data.start} to ${data.end}\n\n${message}`, html };
}

function normalizeSubscription(input = {}, existing = {}) {
  const period = PERIODS.includes(input.period) ? input.period : existing.period || "week";
  const email = String(input.email ?? existing.email ?? "").trim();
  const rawWebhook = input.webhookId === undefined ? existing.webhookId : input.webhookId;
  const webhookId = rawWebhook === null || rawWebhook === "" || rawWebhook === undefined ? null : Number.parseInt(rawWebhook, 10);
  return {
    id: existing.id || randomUUID(),
    userId: String(input.userId ?? existing.userId ?? "").trim(),
    userName: String(input.userName ?? existing.userName ?? "").trim() || null,
    period,
    email,
    webhookId: Number.isFinite(webhookId) ? webhookId : null,
    enabled: input.enabled === undefined ? existing.enabled !== false : Boolean(input.enabled),
    lastSentPeriod: existing.lastSentPeriod || null,
    lastResult: existing.lastResult || null,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function validateSubscription(sub) {
  if (!sub.userId) return "Pick a user for the recap";
  if (!sub.email && !sub.webhookId) return "Add an email address or pick a webhook";
  if (sub.email && !isValidEmail(sub.email)) return "Enter a valid email address";
  return "";
}

async function readSubscriptions() {
  const settings = await getSettings();
  const list = settings[SETTINGS_KEY]?.subscriptions;
  return Array.isArray(list) ? list : [];
}

async function writeSubscriptions(subscriptions) {
  await mergeSettings({ [SETTINGS_KEY]: { subscriptions } });
}

function sameUser(a, b) {
  const clean = (value) => String(value || "").toLowerCase().replace(/-/g, "");
  return Boolean(clean(a)) && clean(a) === clean(b);
}

// scope: { admin, userId } from the request; non-admins only see and change their own.
async function listSubscriptions(scope) {
  const all = await readSubscriptions();
  return scope.admin ? all : all.filter((sub) => sameUser(sub.userId, scope.userId));
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function saveSubscription(input, scope) {
  const all = await readSubscriptions();
  const existing = input.id ? all.find((sub) => sub.id === input.id) : null;
  if (input.id && !existing) throw httpError("Recap delivery not found", 404);
  if (!scope.admin) {
    if (!scope.userId) throw httpError("Your account isn't linked to a media server user", 403);
    if (existing && !sameUser(existing.userId, scope.userId)) throw httpError("Forbidden", 403);
    if (input.userId && !sameUser(input.userId, scope.userId)) throw httpError("Forbidden", 403);
    input = { ...input, userId: scope.userId };
    // Webhooks are server-wide destinations, so only admins can point a recap at one.
    if (input.webhookId !== undefined && input.webhookId !== null && input.webhookId !== "" && Number(input.webhookId) !== Number(existing?.webhookId)) {
      throw httpError("Only admins can send recaps to a webhook", 403);
    }
  }
  const sub = normalizeSubscription(input, existing || {});
  const error = validateSubscription(sub);
  if (error) throw httpError(error, 400);
  if (!sub.userName) {
    const { rows } = await db.query(`SELECT "Name" FROM jf_users WHERE "Id" = $1`, [sub.userId]).catch(() => ({ rows: [] }));
    sub.userName = rows[0]?.Name || null;
  }
  const next = existing ? all.map((row) => (row.id === sub.id ? sub : row)) : [...all, sub];
  if (next.length > MAX_SUBSCRIPTIONS) throw httpError("Too many recap deliveries", 400);
  await writeSubscriptions(next);
  return sub;
}

async function deleteSubscription(id, scope) {
  const all = await readSubscriptions();
  const existing = all.find((sub) => sub.id === id);
  if (!existing) throw httpError("Recap delivery not found", 404);
  if (!scope.admin && !sameUser(existing.userId, scope.userId)) throw httpError("Forbidden", 403);
  await writeSubscriptions(all.filter((sub) => sub.id !== id));
  return true;
}

async function sendToWebhook(webhookId, data, summary, card) {
  const { rows } = await db.query("SELECT * FROM webhooks WHERE id = $1", [webhookId]);
  const webhook = rows[0];
  if (!webhook) throw new Error(`Webhook ${webhookId} no longer exists`);
  if (webhook.enabled === false) throw new Error(`Webhook ${webhook.name} is disabled`);
  const isDiscord = webhook.webhook_type === "discord" || String(webhook.url || "").includes("discord.com/api/webhooks");
  if (isDiscord) {
    const { postDiscordWebhook } = require("./discord-webhook-media");
    const files = card ? [{ name: "wrapped.png", buffer: card, contentType: "image/png" }] : [];
    const embed = { title: summary.title, description: summary.message.slice(0, 4000), color: 0x9b6ac8, footer: { text: `${data.start} to ${data.end}` } };
    if (card) embed.image = { url: "attachment://wrapped.png" };
    await postDiscordWebhook(webhook.url, { embeds: [embed] }, files);
    return;
  }
  const WebhookManager = require("./webhook-manager");
  const ok = await new WebhookManager().executeWebhook(webhook, {
    event: "wrapped_recap",
    title: summary.title,
    message: summary.message,
    triggeredAt: new Date().toISOString(),
    recap: {
      period: data.period,
      start: data.start,
      end: data.end,
      userId: data.userId,
      userName: data.userName,
      hours: Number(hoursText(data.totals?.seconds)),
      plays: Number(data.totals?.plays || 0),
      busiestDay: data.busiestDay || null,
      topShows: data.topShows || [],
      topMovies: data.topMovies || [],
    },
  });
  if (ok === false) throw new Error(`Webhook ${webhook.name} failed`);
}

// Build and send one subscription for the period containing `date`.
async function deliverSubscription(sub, date) {
  const { buildWrapped } = require("./wrapped-recap");
  const data = await buildWrapped({ period: sub.period, date, userId: sub.userId });
  const summary = formatRecap(data);
  let card = null;
  try {
    const { renderWrappedCard } = require("./wrapped-card");
    card = await renderWrappedCard(data);
  } catch (error) {
    console.warn("[WRAPPED] Card render failed, sending text only:", error.message);
  }
  const errors = [];
  if (sub.email) {
    try {
      const { sendConfiguredMail } = require("./smtp-mailer");
      await sendConfiguredMail({
        to: sub.email,
        subject: summary.title,
        text: summary.text,
        html: card ? summary.html : summary.html.replace(/<p style="margin-top:18px"><img[^>]*\/><\/p>/, ""),
        attachments: card ? [{ filename: "wrapped.png", content: card, contentType: "image/png", cid: "wrapped-card" }] : [],
      });
    } catch (error) {
      errors.push(`Email: ${error.message}`);
    }
  }
  if (sub.webhookId) {
    try {
      await sendToWebhook(sub.webhookId, data, summary, card);
    } catch (error) {
      errors.push(`Webhook: ${error.message}`);
    }
  }
  return { ok: errors.length === 0, start: data.start, error: errors.join("; ") || null, title: summary.title };
}

async function recordResult(id, patch) {
  const all = await readSubscriptions();
  await writeSubscriptions(all.map((sub) => (sub.id === id ? { ...sub, ...patch } : sub)));
}

async function sendNow(id, scope) {
  const all = await readSubscriptions();
  const sub = all.find((row) => row.id === id);
  if (!sub) throw httpError("Recap delivery not found", 404);
  if (!scope.admin && !sameUser(sub.userId, scope.userId)) throw httpError("Forbidden", 403);
  const result = await deliverSubscription(sub, lastFinishedPeriodStart(sub.period));
  await recordResult(id, { lastResult: { ok: result.ok, error: result.error, at: new Date().toISOString(), manual: true } });
  return result;
}

// Called by the WrappedRecaps task. Sends each enabled subscription once per finished period.
async function sendDueRecaps(now = new Date()) {
  const results = [];
  for (const sub of await readSubscriptions()) {
    if (sub.enabled === false) continue;
    const due = lastFinishedPeriodStart(sub.period, now);
    if (sub.lastSentPeriod && sub.lastSentPeriod >= due) continue;
    const result = await deliverSubscription(sub, due);
    // Mark the period as handled even on failure so a broken mailbox doesn't retry every hour;
    // the error stays visible on the subscription and "Send now" can retry by hand.
    await recordResult(sub.id, { lastSentPeriod: due, lastResult: { ok: result.ok, error: result.error, at: new Date().toISOString() } });
    results.push({ id: sub.id, ...result });
  }
  return results;
}

module.exports = {
  deleteSubscription,
  deliverSubscription,
  formatRecap,
  lastFinishedPeriodStart,
  listSubscriptions,
  normalizeSubscription,
  saveSubscription,
  sendDueRecaps,
  sendNow,
  validateSubscription,
};
