/**
 * src/app.js
 * Configures and exports the Express application.
 * This file does NOT call app.listen() — that is done in server.js.
 * Supertest can import this file directly without binding a port.
 */

import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

import healthRouter from "./routes/health.routes.js";
import authRouter from "./routes/auth.routes.js";
import studentRouter from "./routes/student.routes.js";
import courseRouter from "./routes/course.routes.js";
import preferenceRouter from "./routes/preference.routes.js";
import allocationRouter from "./routes/allocation.routes.js";
import userRouter from "./routes/user.routes.js";
import semesterRouter from "./routes/semester.routes.js";
import importRouter from "./routes/import.routes.js";

import { notFoundHandler } from "./middleware/notFound.middleware.js";
import { errorHandler } from "./middleware/error.middleware.js";
import { requestId } from "./middleware/requestId.middleware.js";

const app = express();

// Behind a reverse proxy, trust it so req.ip (used by rate limiting) is the
// real client address. 0 = not behind a proxy.
if (env.trustProxy) app.set("trust proxy", env.trustProxy);

// ── Request id (tracing): header on every response, "requestId" on errors ──
app.use(requestId);

// ── Security headers ───────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// ── CORS ──────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: env.clientOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "Content-Disposition"],
  })
);

// ── HTTP request logging ───────────────────────────────────────────────────
if (!env.isTest) {
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      redact: ["req.headers.authorization", "req.headers.cookie"],
      customSuccessMessage(req, res) {
        return `${req.method} ${req.url} ${res.statusCode}`;
      },
    })
  );
}

// ── General API rate limit (login has its own, stricter limiter) ───────────
app.use(
  "/api/",
  rateLimit({
    windowMs: env.rateLimitApiWindowMs ?? 60_000,
    max: env.rateLimitApiMax ?? 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.isTest,
    message: {
      success: false,
      error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down.", details: [] },
    },
  })
);

// ── Body parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

// ── Swagger / OpenAPI ─────────────────────────────────────────────────────
if (!env.isProduction) {
  const swaggerOptions = {
    definition: {
      openapi: "3.0.0",
      info: {
        title: "Course Registration Optimization API",
        version: "1.0.0",
        description:
          "Backend API for the IIT (ISM) Dhanbad Course Registration Optimization System. " +
          "Note: This is a prototype for a final-year project. " +
          "Institutional allocation rules have not been formally confirmed.",
      },
      servers: [
        {
          url: `http://localhost:${env.port}`,
          description: "Local development server",
        },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "token",
          },
        },
      },
    },
    apis: ["./src/routes/*.js"],
  };

  const swaggerSpec = swaggerJsdoc(swaggerOptions);
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// ── Routes ─────────────────────────────────────────────────────────────────
app.use("/health", healthRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/students", studentRouter);
app.use("/api/v1/courses", courseRouter);
app.use("/api/v1/preferences", preferenceRouter);
app.use("/api/v1/allocations", allocationRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/semesters", semesterRouter);
app.use("/api/v1/imports", importRouter);

// ── 404 and error handling ─────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

