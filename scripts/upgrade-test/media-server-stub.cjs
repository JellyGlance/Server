// Minimal Jellyfin stand-in for the upgrade-path test. It answers the handful of
// endpoints JellyGlance touches at start-up and records every path it is asked
// for, so the test can check that request URLs are built correctly. The paths
// are kept in memory and read back from GET /__stub/requests, so nothing a
// client sends is ever written to disk.
const http = require("node:http");

const port = Number(process.env.STUB_PORT || 8096);
const apiKey = process.env.STUB_API_KEY || "upgrade-test-key";
const requests = [];

const serverId = "0123456789abcdef0123456789abcdef";
const adminUser = {
  Id: "11111111111111111111111111111111",
  Name: "upgrade-admin",
  ServerId: serverId,
  Policy: { IsAdministrator: true, IsDisabled: false },
};

const routes = {
  "/system/info/public": { ProductName: "Jellyfin Server", ServerName: "stub", Version: "10.10.7", Id: serverId },
  "/system/info": { ProductName: "Jellyfin Server", ServerName: "stub", Version: "10.10.7", Id: serverId, OperatingSystem: "Linux" },
  "/system/configuration": { ServerName: "stub" },
  "/users": [adminUser],
  "/library/virtualfolders": [],
  "/sessions": [],
  "/items": { Items: [], TotalRecordCount: 0 },
  "/scheduledtasks": [],
  "/plugins": [],
};

function authorised(req) {
  const header = String(req.headers.authorization || req.headers["x-emby-authorization"] || "");
  return header.includes(apiKey) || String(req.headers["x-emby-token"] || "") === apiKey;
}

http
  .createServer((req, res) => {
    const pathOnly = String(req.url || "/").split("?")[0];
    if (pathOnly === "/__stub/requests") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(requests.map((line) => `${line}\n`).join(""));
      return;
    }
    requests.push(`${req.method} ${pathOnly}`);
    const key = pathOnly.toLowerCase();
    const body = routes[key];
    if (key !== "/system/info/public" && !authorised(req)) {
      res.writeHead(401).end();
      return;
    }
    if (body === undefined) {
      // Unknown paths (including "//Users"-style double slashes) get a 404 like real Jellyfin.
      res.writeHead(key.startsWith("//") ? 404 : 200, { "content-type": "application/json" });
      res.end(key.startsWith("//") ? "" : "[]");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  })
  .listen(port, "0.0.0.0", () => console.log(`media server stub listening on ${port}`));
