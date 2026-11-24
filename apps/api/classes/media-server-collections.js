// Jellyfin/Emby calls used by auto collections and poster overlays.
// Both servers share these endpoints, and both accept the MediaBrowser token header.
const configClass = require("./config");
const { axios } = require("./axios");
const { stripTrailingSlashes } = require("../utils/security");

const REQUEST_TIMEOUT_MS = 30000;

async function serverConfig() {
  const config = await new configClass().getConfig();
  if (!config || config.error || config.state !== 2 || !config.JF_HOST || !config.JF_API_KEY) {
    const error = new Error("The media server is not configured yet");
    error.statusCode = 503;
    throw error;
  }
  return { host: stripTrailingSlashes(String(config.JF_HOST)), apiKey: String(config.JF_API_KEY) };
}

async function request(method, path, { params, data, headers = {}, responseType } = {}) {
  const { host, apiKey } = await serverConfig();
  const response = await axios.request({
    method,
    url: `${host}${path}`,
    params,
    data,
    responseType,
    timeout: REQUEST_TIMEOUT_MS,
    maxBodyLength: 25 * 1024 * 1024,
    headers: {
      Authorization: `MediaBrowser Token="${apiKey}"`,
      "X-Emby-Token": apiKey,
      ...headers,
    },
  });
  return response.data;
}

async function findCollectionByName(name) {
  const data = await request("get", "/Items", {
    params: { IncludeItemTypes: "BoxSet", Recursive: true, SearchTerm: name, Limit: 50 },
  });
  const wanted = String(name).trim().toLowerCase();
  return (data?.Items || []).find((item) => String(item.Name || "").trim().toLowerCase() === wanted) || null;
}

async function collectionItemIds(collectionId) {
  const data = await request("get", "/Items", { params: { ParentId: collectionId, Recursive: false, Limit: 5000 } });
  return (data?.Items || []).map((item) => item.Id).filter(Boolean);
}

function chunk(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size));
  return chunks;
}

// Create the collection, or bring an existing one with the same name in line with the preview.
async function syncCollection({ name, ids = [] }) {
  const wanted = [...new Set(ids.filter(Boolean))];
  const existing = await findCollectionByName(name);
  if (!existing) {
    if (!wanted.length) return { created: false, collectionId: null, added: 0, removed: 0 };
    const [first, ...rest] = chunk(wanted, 100);
    const created = await request("post", "/Collections", { params: { Name: name, Ids: first.join(",") } });
    const collectionId = created?.Id;
    for (const ids of rest) {
      await request("post", `/Collections/${encodeURIComponent(collectionId)}/Items`, { params: { Ids: ids.join(",") } });
    }
    return { created: true, collectionId, added: wanted.length, removed: 0 };
  }

  const current = new Set(await collectionItemIds(existing.Id));
  const toAdd = wanted.filter((id) => !current.has(id));
  const wantedSet = new Set(wanted);
  const toRemove = [...current].filter((id) => !wantedSet.has(id));
  for (const ids of chunk(toAdd, 100)) {
    await request("post", `/Collections/${encodeURIComponent(existing.Id)}/Items`, { params: { Ids: ids.join(",") } });
  }
  for (const ids of chunk(toRemove, 100)) {
    await request("delete", `/Collections/${encodeURIComponent(existing.Id)}/Items`, { params: { Ids: ids.join(",") } });
  }
  return { created: false, collectionId: existing.Id, added: toAdd.length, removed: toRemove.length };
}

// maxWidth keeps preview downloads small; applying fetches the full-size poster.
async function getPoster(itemId, { maxWidth } = {}) {
  const data = await request("get", `/Items/${encodeURIComponent(itemId)}/Images/Primary`, {
    params: maxWidth ? { maxWidth, quality: 90 } : { quality: 95 },
    responseType: "arraybuffer",
  });
  return data ? Buffer.from(data) : null;
}

// Jellyfin and Emby take the new image as a base64 body with the image content type.
async function setPoster(itemId, buffer, contentType = "image/jpeg") {
  if (!buffer) throw new Error("No poster image to upload");
  await request("post", `/Items/${encodeURIComponent(itemId)}/Images/Primary`, {
    data: Buffer.from(buffer).toString("base64"),
    headers: { "Content-Type": contentType },
  });
  return true;
}

let adminUserId = null;

// Full item DTOs come from a user-scoped endpoint; an admin user sees every library.
async function getAdminUserId() {
  if (adminUserId) return adminUserId;
  const users = await request("get", "/Users");
  const admin = (Array.isArray(users) ? users : []).find((user) => user?.Policy?.IsAdministrator);
  if (!admin) throw new Error("No administrator user found on the media server");
  adminUserId = admin.Id;
  return adminUserId;
}

async function getFullItem(itemId) {
  const userId = await getAdminUserId();
  return request("get", `/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}`);
}

// Updating an item posts the whole DTO back, so start from the full item and change only Tags.
async function addTag(itemId, tag) {
  const value = String(tag || "").trim();
  if (!value) return false;
  const item = await getFullItem(itemId);
  const tags = Array.isArray(item.Tags) ? item.Tags : [];
  if (tags.some((existing) => String(existing).toLowerCase() === value.toLowerCase())) return false;
  await request("post", `/Items/${encodeURIComponent(itemId)}`, { data: { ...item, Tags: [...tags, value] } });
  return true;
}

async function addToCollection(itemId, collectionName) {
  const name = String(collectionName || "Leaving soon").trim();
  const existing = await findCollectionByName(name);
  if (!existing) {
    const created = await request("post", "/Collections", { params: { Name: name, Ids: itemId } });
    return { created: true, collectionId: created?.Id };
  }
  await request("post", `/Collections/${encodeURIComponent(existing.Id)}/Items`, { params: { Ids: itemId } });
  return { created: false, collectionId: existing.Id };
}

module.exports = {
  request,
  getFullItem,
  addTag,
  addToCollection,
  findCollectionByName,
  syncCollection,
  getPoster,
  setPoster,
};
