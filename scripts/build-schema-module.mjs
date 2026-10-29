// One-off generator: embeds the SQLite schema into a TS module so it is always
// present in the server bundle. Re-run after editing 0001_init.sql:
//   node scripts/build-schema-module.mjs
import fs from "node:fs";

const src = "src/lib/db/migrations/0001_init.sql";
const sql = fs.readFileSync(src, "utf8");

if (sql.includes("`") || sql.includes("${")) {
  throw new Error("SQL contains TS template metacharacters; escape them first.");
}

const escaped = sql.replaceAll("\\", "\\\\");

const out = `/**
 * Local SQLite schema (authoritative store on the scoring laptop).
 * Generated from src/lib/db/migrations/0001_init.sql by
 * scripts/build-schema-module.mjs — edit the .sql file, then re-run the script.
 * The hosted/cloud equivalent lives in supabase/migrations/0001_init.sql.
 */
export const MIGRATION_0001_INIT = \`${escaped}\`;
`;

fs.writeFileSync("src/lib/db/schema.ts", out);
console.log(`wrote src/lib/db/schema.ts (${sql.length} chars of SQL)`);
