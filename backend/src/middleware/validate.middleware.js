/**
 * src/middleware/validate.middleware.js
 * Zod validation middleware for request body, query, and params.
 */

import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError.js";

/**
 * Returns Express middleware that validates req[target] against a Zod schema.
 * @param {import("zod").ZodSchema} schema
 * @param {"body"|"query"|"params"} target
 */
export function validate(schema, target = "body") {
  return (req, res, next) => {
    try {
      req[target] = schema.parse(req[target]);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        }));
        return next(
          ApiError.validation("The request contains invalid fields.", details)
        );
      }
      next(err);
    }
  };
}

