function schemaDownloadHref(originalUrl) {
  const pathname = String(originalUrl || "/").split("?")[0];
  const base = pathname.replace(/\/swagger-ui(?:\/.*)?$/, "");
  const href = `${base}/swagger.json?download=1`;
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*swagger\.json\?download=1$/.test(href)) {
    return "/swagger.json?download=1";
  }
  return href;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function injectSchemaDownload(html, href) {
  const link = `<div class="jg-schema-download"><a href="${escapeAttr(href)}" download="jellyglance-api.json">Download API schema</a></div>`;
  return String(html).replace('<div id="swagger-ui"></div>', `${link}\n<div id="swagger-ui"></div>`);
}

function sendSwaggerJson(document, req, res) {
  res.set("Cache-Control", "no-store");
  if (String(req.query?.download || "") === "1") {
    res.set("Content-Disposition", 'attachment; filename="jellyglance-api.json"');
  }
  res.json(document);
}

function attachSchemaDownload(pageHandler) {
  return function schemaDownloadPage(req, res, next) {
    const href = schemaDownloadHref(req.originalUrl);
    const send = res.send.bind(res);
    res.send = (body) => send(typeof body === "string" ? injectSchemaDownload(body, href) : body);
    return pageHandler(req, res, next);
  };
}

function mountSwaggerUi(app, swaggerUi, document) {
  app.get("/swagger.json", (req, res) => {
    sendSwaggerJson(document, req, res);
  });
  app.use(
    "/swagger-ui",
    swaggerUi.serve,
    attachSchemaDownload(swaggerUi.setup(document, {
      customSiteTitle: "JellyGlance API",
      customCss: `
        .jg-schema-download { display: flex; justify-content: flex-end; padding: 12px 16px 0; }
        .jg-schema-download a {
          display: inline-flex;
          align-items: center;
          min-height: 36px;
          padding: 0 12px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 11px;
          background: rgba(255, 255, 255, 0.04);
          color: #d7e0ee;
          font: 850 13px/1 system-ui, sans-serif;
          text-decoration: none;
        }
        .jg-schema-download a:hover { color: #fff; border-color: rgba(255, 255, 255, 0.28); }
        .swagger-ui .topbar { display: none; }
        body { margin: 0; background: #0b1118; }
        .swagger-ui { background: transparent; }
        .swagger-ui .info .title { display: none; }
        .swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info table { color: #9aa7bb; }
        .swagger-ui .scheme-container { background: #121821; box-shadow: none; }
        .swagger-ui .opblock-tag { color: #f8fafc; border-color: rgba(255,255,255,0.08); }
      `,
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: "alpha",
        operationsSorter: "alpha",
      },
    }))
  );
}

module.exports = {
  attachSchemaDownload,
  injectSchemaDownload,
  mountSwaggerUi,
  schemaDownloadHref,
  sendSwaggerJson,
};
