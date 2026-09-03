import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createLogger } from "./lib/logger.js";
import { config } from "./lib/config.js";
import { getDb, closeDb } from "./lib/database.js";
import { adminApi } from "./admin-api.js";
import { proxyApi } from "./proxy-api.js";
import { startHealthChecker, stopHealthChecker } from "./lib/health-checker.js";
import { startIntakeWatcher, stopIntakeWatcher } from "./lib/intake-watcher.js";
import { APP_FULL_NAME, APP_VERSION } from "./lib/version.js";

const log = createLogger("server");

// Initialize database
getDb();

const app = new Hono();

// Mount admin API (no base path, just /api/* routes)
app.route("/", adminApi);

// Mount proxy API (/v1/*, /health, /ready, /metrics)
app.route("/", proxyApi);

// Root redirect
app.get("/", (c) => {
  return c.json({
    name: APP_FULL_NAME,
    version: APP_VERSION,
    endpoints: {
      admin: "/api/keys, /api/groups, /api/logs, /api/stats/summary",
      proxy: "/v1/chat/completions, /v1/embeddings, /v1/models",
      health: "/health, /ready, /metrics",
    },
  });
});

const port = config.proxy.port;
const host = config.proxy.host;

log.info(`Starting ${APP_FULL_NAME} v${APP_VERSION}`, { port, host });

const server = serve({
  fetch: app.fetch,
  port,
  hostname: host,
});

log.info(`Proxy server listening on http://${host}:${port}`);

// Start periodic health checker (every 3 hours)
startHealthChecker({ intervalHours: 3, enabled: true });

// Watch the intake folder for dropped key files (./incoming by default)
startIntakeWatcher();

// Graceful shutdown
const shutdown = () => {
  log.info("Shutting down...");
  stopHealthChecker();
  stopIntakeWatcher();
  server.close();
  closeDb();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("SIGTERM", () => {
  log.info("Shutting down...");
  stopHealthChecker();
  server.close();
  closeDb();
  process.exit(0);
});

export default app;
