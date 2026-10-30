/**
 * src/middleware/requestId.middleware.js
 * Gives every request an id for tracing.
 *   - A client-supplied X-Request-Id is reused only if it is short and made of
 *     safe characters (it ends up in logs and responses); otherwise a UUID.
 *   - The id is returned in the X-Request-Id header and, for error responses
 *     ({ success: false, ... }), also as "requestId" in the JSON body, so a
 *     user can quote it when reporting a problem.
 */

import { randomUUID } from "node:crypto";

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function requestId(req, res, next) {
  const incoming = req.get("x-request-id");
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();

  req.id = id;
  res.set("X-Request-Id", id);

  const json = res.json.bind(res);
  res.json = (body) =>
    json(
      body && typeof body === "object" && body.success === false && body.requestId === undefined
        ? { ...body, requestId: id }
        : body
    );

  next();
}
