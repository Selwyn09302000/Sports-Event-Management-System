import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MIGRATIONS } from "./migrations";

export type Db = DatabaseSync;

const DEFAULT_DB_PATH = "./data/local.sqlite";

/** Absolute path of the local SQLite file ("mem" only in tests). */
export function resolveDbPath(): string {
  const configured = process.env.LOCAL_DB_PATH?.trim() || DEFAULT_DB_PATH;
  if (configured === ":memory:") return configured;
  return resolve(process.cwd(), configured);
}

function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: string }[]).map(
      (row) => row.version,
    ),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${migration.version} failed: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }
}

/** Seed the sport catalogue. Idempotent. */
function seed(db: Db): void {
  db.prepare("INSERT OR IGNORE INTO sports (key, name, created_at) VALUES (?, ?, ?)").run(
    "basketball",
    "Basketball",
    new Date().toISOString(),
  );
}

export function openDatabase(path = resolveDbPath()): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = FULL");
  migrate(db);
  seed(db);
  return db;
}

type DbGlobal = { db?: Db; path?: string };
const globalRef = globalThis as unknown as { __semDb?: DbGlobal };

/**
 * Process-wide connection. Next's dev server re-evaluates modules on hot
 * reload, so the handle is cached on globalThis instead of module scope.
 */
export function getDb(): Db {
  const path = resolveDbPath();
  if (globalRef.__semDb?.db && globalRef.__semDb.path === path) return globalRef.__semDb.db;
  const db = openDatabase(path);
  globalRef.__semDb = { db, path };
  return db;
}

/** Test helper: drop the cached handle so the next getDb() reopens. */
export function resetDbForTests(db?: Db): void {
  if (db) {
    globalRef.__semDb = { db, path: ":memory:" };
  } else {
    delete globalRef.__semDb;
  }
}

/**
 * Runs `fn` inside an immediate write transaction. Nested calls reuse the
 * outer transaction so repository helpers can compose safely.
 */
let txDepth = 0;
export function transaction<T>(fn: (db: Db) => T): T {
  const db = getDb();
  if (txDepth > 0) return fn(db);

  db.exec("BEGIN IMMEDIATE");
  txDepth += 1;
  try {
    const result = fn(db);
    txDepth -= 1;
    db.exec("COMMIT");
    return result;
  } catch (error) {
    txDepth -= 1;
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction may already be rolled back by SQLite (e.g. on crash).
    }
    throw error;
  }
}
