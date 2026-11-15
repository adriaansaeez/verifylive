import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL,
  fixture_id TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  final INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(session_id, seq);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL,
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  quote TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  checkability TEXT NOT NULL,
  search_queries TEXT NOT NULL DEFAULT '[]',
  dedupe_key TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_dedupe ON claims(session_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_claims_session ON claims(session_id, start_ms);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  publisher TEXT,
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  source_tier TEXT NOT NULL,
  stance TEXT,
  connector TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_claim ON evidence(claim_id);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  confidence REAL NOT NULL,
  checkable_probability REAL NOT NULL,
  evidence_quality_score REAL NOT NULL,
  needs_more_sources_probability REAL NOT NULL,
  evidence_ids TEXT NOT NULL,
  summary TEXT NOT NULL,
  provisional INTEGER NOT NULL DEFAULT 0,
  simulated INTEGER NOT NULL DEFAULT 0,
  clef_ms INTEGER,
  raw TEXT,
  diagnostics TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_revisions_claim_rev ON revisions(claim_id, revision);

CREATE TABLE IF NOT EXISTS publishers (
  host TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

/** CREATE TABLE IF NOT EXISTS never adds a column to a database that already
 * exists, and the SQLite file deliberately outlives the project tree. */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: "revisions", column: "diagnostics", definition: "TEXT" },
];

function applyAddedColumns(db: DatabaseSync): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name?: unknown }[];
    if (columns.some((row) => row.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Bump this whenever SCHEMA or ADDED_COLUMNS changes.
 *
 * The connection is cached on globalThis so it survives hot reload, which
 * means a schema written after the server started was never applied to it:
 * eighteen analyses died today with "no such table: publishers" and "table
 * revisions has no column named diagnostics", both from editing the schema
 * of a running server. Comparing a stamped version on every call costs one
 * PRAGMA and migrates the live connection instead.
 */
const SCHEMA_VERSION = 2;

function migrate(db: DatabaseSync): void {
  db.exec(SCHEMA);
  applyAddedColumns(db);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

function schemaVersionOf(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: unknown } | undefined;
  return Number(row?.user_version ?? 0);
}

type GlobalWithDb = typeof globalThis & { __veritasDb?: DatabaseSync };

function databasePath(): string {
  const configured = process.env.VERITAS_DB?.trim();
  // This is runtime state, not a build input. The narrow Turbopack annotation
  // prevents tracing the whole project while preserving a configurable path.
  if (configured) return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
  // Keep the database OUTSIDE the project tree: Turbopack watches every file
  // under it, so SQLite writes (.sqlite-wal grows on each commit) trigger a
  // recompile, which reloads the page, which writes again — an infinite loop.
  return path.join(os.homedir(), ".cache", "veritas-live", "veritas.sqlite");
}

export function getDb(): DatabaseSync {
  const globalStore = globalThis as GlobalWithDb;
  const existing = globalStore.__veritasDb;
  if (existing) {
    // Cheap on every call, and the only thing that catches a schema edited
    // while this connection was already open.
    if (schemaVersionOf(existing) !== SCHEMA_VERSION) migrate(existing);
    return existing;
  }

  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA wal_autocheckpoint = 256;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db);
  globalStore.__veritasDb = db;
  return db;
}

export function transaction<T>(work: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function rowToRecord(row: unknown): Record<string, unknown> {
  return row as Record<string, unknown>;
}
