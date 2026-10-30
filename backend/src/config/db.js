/**
 * src/config/db.js
 * Establishes and exports the Mongoose connection.
 */

import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

let isConnected = false;

export async function connectDB() {
  if (isConnected) return;

  mongoose.set("strictQuery", true);

  mongoose.connection.on("connected", () => {
    isConnected = true;
    logger.info("MongoDB connected");
  });

  mongoose.connection.on("disconnected", () => {
    isConnected = false;
    logger.warn("MongoDB disconnected");
  });

  mongoose.connection.on("error", (err) => {
    logger.error({ err: err.message }, "MongoDB connection error");
  });

  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });

  isConnected = true;
}

export async function disconnectDB() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  logger.info("MongoDB disconnected (graceful)");
}

export function getDbStatus() {
  const stateMap = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };
  return stateMap[mongoose.connection.readyState] ?? "unknown";
}

