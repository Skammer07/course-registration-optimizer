/**
 * tests/unit/apiError.test.js
 * Unit tests for ApiError utility class.
 */

import { describe, it, expect } from "vitest";
import { ApiError } from "../../src/utils/ApiError.js";

describe("ApiError", () => {
  it("creates a 400 bad request error", () => {
    const err = ApiError.badRequest("Bad input");
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("Bad input");
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
  });

  it("creates a 401 unauthorized error", () => {
    const err = ApiError.unauthorized();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("creates a 403 forbidden error", () => {
    const err = ApiError.forbidden("Admins only");
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("Admins only");
  });

  it("creates a 404 not found error", () => {
    const err = ApiError.notFound("Student");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Student not found");
  });

  it("creates a 409 conflict error", () => {
    const err = ApiError.conflict("Duplicate key");
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("CONFLICT");
  });

  it("creates a validation error with details", () => {
    const details = [{ field: "email", message: "Invalid email" }];
    const err = ApiError.validation("Validation failed", details);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toEqual(details);
  });
});

