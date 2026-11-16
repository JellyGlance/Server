// Bulk approve / decline / retry over the existing per-request Seerr actions.
// Pure helpers here; the route supplies the function that performs one action, so the
// read-only guard, the admin check and every Seerr call stay in one place (routes/api.js).
const ACTIONS = ["approve", "decline", "retry"];
const MAX_ITEMS = 50;

class BulkInputError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

// -> { action, items: [{ requestId, sourceId, title }] }, or throws BulkInputError.
function normalizeBulkInput(body = {}) {
  const action = String(body?.action || "").toLowerCase();
  if (!ACTIONS.includes(action)) throw new BulkInputError("Choose approve, decline or retry");
  const raw = Array.isArray(body?.items) ? body.items : [];
  if (!raw.length) throw new BulkInputError("Select at least one request");
  const seen = new Set();
  const items = [];
  for (const entry of raw) {
    const requestId = String(entry?.requestId ?? "").trim();
    const sourceId = String(entry?.sourceId ?? "").trim();
    if (!/^\d{1,12}$/.test(requestId) || !sourceId || sourceId.length > 80) throw new BulkInputError("Each item needs a request id and a source");
    const key = `${sourceId}:${requestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = (value) => (/^\d{1,12}$/.test(String(value ?? "")) ? String(value) : undefined);
    const mediaType = String(entry?.mediaType || "").toLowerCase();
    items.push({
      requestId,
      sourceId,
      title: String(entry?.title || "").slice(0, 160),
      mediaType: ["movie", "tv", "series"].includes(mediaType) ? mediaType : undefined,
      tmdb: id(entry?.tmdb),
      tvdb: id(entry?.tvdb),
    });
  }
  if (items.length > MAX_ITEMS) throw new BulkInputError(`Select at most ${MAX_ITEMS} requests at a time`);
  return { action, items };
}

function errorText(error) {
  return String(error?.message || error || "Action failed").slice(0, 200);
}

// Runs the items one after another (Seerr and the *arr apps are not hammered in parallel)
// and keeps going after a failure, so each item gets its own result.
async function runBulk({ action, items, runOne, afterEach }) {
  const results = [];
  for (const item of items) {
    try {
      await runOne(item, action);
      results.push({ requestId: item.requestId, sourceId: item.sourceId, title: item.title, ok: true });
    } catch (error) {
      results.push({ requestId: item.requestId, sourceId: item.sourceId, title: item.title, ok: false, status: error?.statusCode || error?.response?.status || null, error: errorText(error) });
    }
    if (afterEach) await afterEach();
  }
  const succeeded = results.filter((result) => result.ok).length;
  return { action, total: results.length, succeeded, failed: results.length - succeeded, results };
}

module.exports = { ACTIONS, MAX_ITEMS, BulkInputError, normalizeBulkInput, runBulk };
