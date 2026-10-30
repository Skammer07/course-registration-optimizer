/**
 * src/validators/import.schema.js
 * Query options for the CSV import endpoints.
 */

import { z } from "zod";

const bool = (defaultValue) =>
  z.enum(["true", "false"]).transform((v) => v === "true").optional().default(defaultValue);

export const importQuerySchema = z.object({
  // validate everything and report, but write nothing
  dryRun: bool(false),
  // existing records: "skip" (default) or "update" (empty cells never overwrite)
  onExisting: z.enum(["skip", "update"]).optional().default("skip"),
  // students only: also create a login with a one-time temporary password
  createLogins: bool(false),
  // preferences only: status of the imported lists
  status: z.enum(["draft", "submitted"]).optional().default("submitted"),
});
