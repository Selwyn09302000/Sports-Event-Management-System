/**
 * Local backup. Produces a consistent snapshot of the SQLite database using
 * `VACUUM INTO`, which is safe while the server is running.
 *
 *   node scripts/backup.mjs [target-directory]
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const source = resolve(process.cwd(), process.env.LOCAL_DB_PATH || "./data/local.sqlite");
const targetDir = resolve(process.cwd(), process.argv[2] || "./backups");

mkdirSync(targetDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = join(targetDir, `local-${stamp}.sqlite`);

const db = new DatabaseSync(source);
try {
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
} finally {
  db.close();
}

const size = statSync(target).size;
console.log(`Backup written: ${target} (${(size / 1024).toFixed(1)} KB)`);
console.log("\nStore a copy somewhere other than this laptop before leaving the venue.");
