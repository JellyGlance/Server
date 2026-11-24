import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../api", "JS_");
  const apiTarget = process.env.JS_API_URL || env.JS_API_URL || "http://127.0.0.1:3000";
  const devPort = Number(process.env.JS_DEV_PORT || env.JS_DEV_PORT || 3001);

  return {
    envPrefix: "JS_",
    base: env.JS_BASE_URL ?? "/",
    envDir: "../api",

    optimizeDeps: {
      include: ["react", "react-dom", "react-router-dom", "axios", "react-toastify"],
      esbuildOptions: {
        loader: {
          ".js": "jsx",
        },
      },
    },

    resolve: {
      dedupe: ["react", "react-dom"],
    },

    server: {
      port: devPort,
      strictPort: false,
      proxy: (() => {
        const proxyPaths = [
          "/api",
          "/proxy",
          "/stats",
          "/sync",
          "/auth",
          "/backup",
          "/logs",
          "/swagger-ui",
          "/swagger.json",
          "/utils",
          "/webhooks",
          "/newsletter",
          "/tautulli",
          "/jellystat",
          "/env.js",
          // Mounted in apps/api/server.js but were missing here, so the dev server
          // answered them with index.html (the Recap tab crashed on that).
          "/alerts-data",
          "/auto-collections",
          "/backup-download",
          "/cleanup-rules",
          "/cleanuparr",
          "/external-imports",
          "/incomplete-seasons",
          "/insights-data",
          "/newsletter-archive-data",
          "/ops-copilot",
          "/server-tasks",
          "/status-data",
          "/subtitle-gap",
          "/webhook-cards",
          "/webhook-out-data",
          "/calendar-feed",
          "/library-tools",
        ];
        const proxy = Object.fromEntries(
          proxyPaths.map((pathName) => [
            pathName,
            {
              target: apiTarget,
              changeOrigin: true,
              ...(pathName === "/backup"
                ? { timeout: 0, proxyTimeout: 0 }
                : {}),
            },
          ])
        );
        proxy["/socket.io"] = { target: apiTarget, changeOrigin: true, ws: true };
        return proxy;
      })(),
    },

    build: {
      target: "es2015",
      // Vite 8 bundles with rolldown's automatic code splitting. Named vendor groups
      // (the old rollupOptions.manualChunks) pull every group into the first load and
      // roughly triple it, so heavy libraries stay in the lazy route chunks instead.
      chunkSizeWarningLimit: 900,
      rolldownOptions: {
        output: {
          codeSplitting: true,
        },
      },
    },

    plugins: [react()],
  };
});
