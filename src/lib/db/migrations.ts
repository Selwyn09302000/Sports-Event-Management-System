/**
 * Migration registry. Each entry is applied at most once and recorded in
 * `schema_migrations`, so migrations stay reproducible and ordered.
 */
import { MIGRATION_0001_INIT } from "./schema";

export type Migration = { version: string; sql: string };

export const MIGRATIONS: Migration[] = [{ version: "0001_init", sql: MIGRATION_0001_INIT }];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
