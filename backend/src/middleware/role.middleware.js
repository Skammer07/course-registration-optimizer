/**
 * src/middleware/role.middleware.js
 * Role-based authorization middleware.
 */

import { ApiError } from "../utils/ApiError.js";

/**
 * Returns middleware that checks req.user.role against the allowed roles.
 * Must be used after requireAuth.
 * @param {...string} roles  Allowed role strings, e.g. "admin", "faculty"
 */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }
    if (!roles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `This action requires one of the following roles: ${roles.join(", ")}.`
        )
      );
    }
    next();
  };
}

