import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.jsx";
import PublicStatusPage from "./pages/public-status.jsx";

import "./pages/css/variables.css";
import "./index.css";
import "bootstrap/dist/css/bootstrap.min.css";
import "./pages/css/width_breakpoint_css.css";
import "./pages/css/radius_breakpoint_css.css";

import i18n from "i18next";
import Backend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import Loading from "./pages/components/general/loading.jsx";
import baseUrl from "./lib/baseurl.jsx";
import { FIRST_RUN_EXTRAS_KEY } from "./lib/first-run";
import { languages, languageDirection } from "./lib/languages.js";
import { DEFAULT_THEME, applyTheme } from "./lib/theme";
import { initPwaInstall } from "./lib/pwa-install";
import { isEmby } from "./lib/media-server";

initPwaInstall();

// The public status page works without logging in, so it skips the app shell entirely.
const isPublicStatusPath = window.location.pathname.replace(/\/+$/, "") === `${baseUrl}/status`;

const setupFlowNeedsDefaultTheme = !localStorage.getItem("token") || localStorage.getItem(FIRST_RUN_EXTRAS_KEY) === "true";
applyTheme(setupFlowNeedsDefaultTheme ? DEFAULT_THEME : undefined);

// Translations name the media server as Jellyfin; on Emby installs show Emby instead.
const mediaServerNamePostProcessor = {
  type: "postProcessor",
  name: "mediaServerName",
  process: (value) => (typeof value === "string" && isEmby() ? value.replace(/Jellyfin/g, "Emby") : value),
};

// Keep <html lang> and dir in step with the UI language so right-to-left languages lay out correctly.
function applyDocumentLanguage(languageCode) {
  if (!languageCode) return;
  document.documentElement.lang = languageCode;
  document.documentElement.dir = languageDirection(languageCode);
}

i18n.on("languageChanged", applyDocumentLanguage);

i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .use(mediaServerNamePostProcessor)
  .init({
    postProcess: ["mediaServerName"],
    fallbackLng: "en-GB",
    supportedLngs: languages.map((language) => language.id),
    load: "currentOnly",
    partialBundledLanguages: true,
    debug: false,
    ns: ["translation"],
    defaultNS: "translation",
    backend: {
      loadPath: `${baseUrl}/locales/{{lng}}/{{ns}}.json`,
    },
    detection: {
      order: ["localStorage", "cookie", "sessionStorage", "navigator", "htmlTag", "querystring", "path", "subdomain"],
      caches: ["localStorage", "cookie"],
    },
    interpolation: {
      escapeValue: false,
    },
  })
  .then(() => {
    applyDocumentLanguage(i18n.resolvedLanguage || i18n.language);
    createRoot(document.getElementById("root")).render(
      <React.StrictMode>
        <Suspense fallback={<Loading />}>
          {isPublicStatusPath ? (
            <PublicStatusPage />
          ) : (
            <BrowserRouter basename={baseUrl}>
              <App />
            </BrowserRouter>
          )}
        </Suspense>
      </React.StrictMode>
    );
  });
