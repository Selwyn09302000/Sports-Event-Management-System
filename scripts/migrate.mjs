/**
 * Applies pending local migrations without starting the web server.
 *
 *   node scripts/migrate.mjs
 *
 * The app also migrates automatically on first connection, so this is mainly
 * for pre-flight checks before a tournament.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const path = resolve(process.cwd(), process.env.LOCAL_DB_PATH || "./data/local.sqlite");
mkdirSync(dirname(path), { recursive: true });

const db = new DatabaseSync(path);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));

const migrations = [
  { version: "0001_init", file: "src/lib/db/migrations/0001_init.sql" },
];

for (const migration of migrations) {
  if (applied.has(migration.version)) {
    console.log(`skip ${migration.version} (already applied)`);
    continue;
  }
  const sql = readFileSync(migration.file, "utf8");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
      migration.version,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
    console.log(`applied ${migration.version}`);
  } catch (error) {
    db.exec("ROLLBACK");
    console.error(`FAILED ${migration.version}: ${error.message}`);
    process.exit(1);
  }
}

db.prepare("INSERT OR IGNORE INTO sports (key, name, created_at) VALUES (?, ?, ?)").run(
  "basketball",
  "Basketball",
  new Date().toISOString(),
);

db.close();
console.log(`Local database ready at ${path}`);
