/**
 * scripts/create-admin.js - create the first admin (or recover one).
 *
 *   node scripts/create-admin.js --email admin@college.edu
 *   node scripts/create-admin.js --email admin@college.edu --reset
 *
 * Needs MONGODB_URI and JWT_SECRET in the environment / .env. Works in
 * production. With no --password a temporary password is generated and
 * printed ONCE; the admin must change it at first login.
 *
 * Windows PowerShell: call the script directly with node as above (npm run
 * swallows the "--" separator).
 */

import { connectDB, disconnectDB } from "../src/config/db.js";
import { bootstrapAdmin } from "../src/services/adminBootstrap.service.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log("Usage: node scripts/create-admin.js --email <email> [--password <text>] [--reset]");
    return;
  }
  if (typeof args.email !== "string") throw new Error("--email is required.");
  if (args.password === true) throw new Error("--password needs a value (or omit it to generate one).");

  await connectDB();
  try {
    const result = await bootstrapAdmin({
      email: args.email,
      password: typeof args.password === "string" ? args.password : undefined,
      reset: Boolean(args.reset),
    });
    console.log(`Admin ${result.action}: ${result.email}`);
    if (result.mustChangePassword) {
      console.log(`Temporary password (shown once): ${result.password}`);
      console.log("The admin must change it at first login (POST /api/v1/auth/change-password).");
    } else {
      console.log("The password you supplied was set. It is visible in your shell history; consider changing it.");
    }
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error("create-admin failed:", err.message);
  process.exit(1);
});
