const db = require("../db");
const { stripTrailingSlashes } = require("../utils/security");
const { resolveServerType, setActiveServerType } = require("./server-type");

let cachedConfig = null;
let cachedConfigAt = 0;
const CONFIG_CACHE_MS = 8000;

// Saved or env-provided hosts may carry a trailing slash (e.g. "http://h:8096/"),
// which turns `${JF_HOST}/Users` into "//Users". Strip it on read so existing
// installs are repaired without a settings re-save.
function normalizeHost(value) {
  if (value == null) return value;
  return stripTrailingSlashes(value);
}

class Config {
  async getConfig() {
    try {
      if (cachedConfig && Date.now() - cachedConfigAt < CONFIG_CACHE_MS) {
        return cachedConfig;
      }

      //Manual overrides
      process.env.POSTGRES_USER = process.env.POSTGRES_USER ?? "postgres";

      //
      const { rows: config } = await db.query('SELECT * FROM app_config where "ID"=1');

      const state = this.#getConfigState(config);

      if (state < 1) {
        return { state: 0, error: "Config Details Not Found" };
      }

      const _config = config[0];
      const serverType = resolveServerType(_config.settings);
      setActiveServerType(serverType);

      const result = {
        JF_HOST: normalizeHost(process.env.JF_HOST ?? _config.JF_HOST),
        JF_EXTERNAL_HOST: _config.settings?.EXTERNAL_URL,
        JF_API_KEY: process.env.JF_API_KEY ?? _config.JF_API_KEY,
        APP_USER: _config.APP_USER,
        APP_PASSWORD: _config.APP_PASSWORD,
        REQUIRE_LOGIN: _config.REQUIRE_LOGIN,
        settings: _config.settings,
        api_keys: _config.api_keys,
        state: state,
        SERVER_TYPE: serverType,
        IS_JELLYFIN: serverType === "jellyfin",
      };
      cachedConfig = result;
      cachedConfigAt = Date.now();
      return result;
    } catch (error) {
      console.log("Error fetching config:", error);
      return { error: "Config Details Not Found" };
    }
  }

  clearCache() {
    cachedConfig = null;
    cachedConfigAt = 0;
  }

  async getPreferedAdmin() {
    const config = await this.getConfig();
    return config.settings?.preferred_admin?.userid;
  }

  async getExcludedLibraries() {
    const config = await this.getConfig();
    return config.settings?.ExcludedLibraries ?? [];
  }

  #getConfigState(Configured) {
    let state = 0;
    try {
      //state 0 = no Jellyfin connection
      //state 1 = Jellyfin configured, admin access not configured
      //state 2 = Jellyfin configured and admin access configured

      if (Configured.length > 0) {
        const row = Configured[0];
        const settings = row.settings || {};
        const hasJellyfinApiKey =
          row.JF_API_KEY !== null &&
          !(typeof row.JF_API_KEY === "string" && row.JF_API_KEY.trim() === "");
        const hasLegacyAdminUser = row.APP_USER !== null && row.APP_USER !== "";
        const hasLocalUsers = Array.isArray(settings.localUsers) && settings.localUsers.some((user) => user?.username);
        const hasAdminUser = hasLegacyAdminUser || hasLocalUsers || ["local-auth", "oidc", "jellyfin-quick-connect"].includes(row.APP_USER);

        if (hasJellyfinApiKey && hasAdminUser) state = 2;
        else if (hasJellyfinApiKey) state = 1;
      }
      return state;
    } catch (error) {
      return state;
    }
  }
}

module.exports = Config;
