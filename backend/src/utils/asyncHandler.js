/**
 * src/utils/asyncHandler.js
 * Wraps an async Express handler to forward errors to next().
 */

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

