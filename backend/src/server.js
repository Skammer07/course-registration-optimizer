/**
 * src/server.js
 * Entry point: connects to MongoDB, then starts the HTTP server.
 * Handles graceful shutdown on SIGINT and SIGTERM.
 */

import { env } from "./config/env.js";
import { connectDB, disconnectDB } from "./config/db.js";
import { logger } from "./utils/logger.js";
import { seedAdminIfNeeded } from "./services/auth.service.js";
import app from "./app.js";

async function start() {
  try {
    await connectDB();
    await seedAdminIfNeeded();
  } catch (err) {
    logger.fatal({ err: err.message }, "Failed to connect to MongoDB. Exiting.");
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    logger.info(
      { port: env.port, env: env.nodeEnv },
      `Server started on port ${env.port}`
    );
    if (env.isDevelopment) {
      logger.info(`API docs: http://localhost:${env.port}/api-docs`);
    }
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  async function shutdown(signal) {
    logger.info({ signal }, "Shutdown signal received. Closing server…");
    server.close(async () => {
      await disconnectDB();
      logger.info("Server shut down cleanly.");
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error("Forced shutdown after timeout.");
      process.exit(1);
    }, 10_000);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("uncaughtException", (err) => {
    logger.fatal({ err: err.message }, "Uncaught exception — shutting down");
    shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason: String(reason) }, "Unhandled promise rejection");
    shutdown("unhandledRejection");
  });
}

start();

