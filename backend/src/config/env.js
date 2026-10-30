/**
 * src/config/env.js
 * Validates and exports required environment variables.
 * Throws at startup if any required variable is missing.
 */

import { config } from "dotenv";

// Load .env only in non-production or when not already set.
config();

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill in your values.`
    );
  }
  return value.trim();
}

function optional(name, defaultValue) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : defaultValue;
}

const MIN_JWT_SECRET_LENGTH = 32;

export const env = {
  port: parseInt(optional("PORT", "5000"), 10),
  nodeEnv: optional("NODE_ENV", "development"),
  mongoUri: required("MONGODB_URI"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: optional("JWT_EXPIRES_IN", "15m"),
  clientOrigin: optional("CLIENT_ORIGIN", "http://localhost:5173"),
  rateLimitLoginMax: parseInt(optional("RATE_LIMIT_LOGIN_MAX", "10"), 10),
  rateLimitLoginWindowMs: parseInt(
    optional("RATE_LIMIT_LOGIN_WINDOW_MS", "900000"),
    10
  ),
  // Number of reverse proxies in front of the app (0 = none). Needed for
  // correct client IPs in rate limiting when deployed behind a proxy/load balancer.
  trustProxy: parseInt(optional("TRUST_PROXY", "0"), 10),
  rateLimitApiMax: parseInt(optional("RATE_LIMIT_API_MAX", "300"), 10),
  rateLimitApiWindowMs: parseInt(optional("RATE_LIMIT_API_WINDOW_MS", "60000"), 10),
  // Development-only seed admin (never used in production)
  seedAdminEmail: optional("SEED_ADMIN_EMAIL", ""),
  seedAdminPassword: optional("SEED_ADMIN_PASSWORD", ""),

  get isDevelopment() {
    return this.nodeEnv === "development";
  },
  get isTest() {
    return this.nodeEnv === "test";
  },
  get isProduction() {
    return this.nodeEnv === "production";
  },
};

// A short secret is trivially brute-forceable; refuse to start in production.
if (env.isProduction && env.jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
  throw new Error(
    `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production.`
  );
}
