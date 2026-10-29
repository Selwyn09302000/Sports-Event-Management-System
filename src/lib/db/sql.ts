import { getDb, type Db } from "./client";

/** Values accepted by node:sqlite bindings (booleans are not accepted). */
export type SqlValue = string | number | bigint | null | Uint8Array;

export function normalizeParam(value: SqlValue | boolean | undefined): SqlValue {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

export function all<T>(
  sql: string,
  params: (SqlValue | boolean | undefined)[] = [],
  db: Db = getDb(),
): T[] {
  return db.prepare(sql).all(...params.map(normalizeParam)) as T[];
}

export function one<T>(
  sql: string,
  params: (SqlValue | boolean | undefined)[] = [],
  db: Db = getDb(),
): T | undefined {
  return db.prepare(sql).get(...params.map(normalizeParam)) as T | undefined;
}

export function run(
  sql: string,
  params: (SqlValue | boolean | undefined)[] = [],
  db: Db = getDb(),
): { changes: number } {
  const result = db.prepare(sql).run(...params.map(normalizeParam));
  return { changes: Number(result.changes) };
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
