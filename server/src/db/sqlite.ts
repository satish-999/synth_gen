import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { RUNS_PATH } from "../config.js";

type NamedParams = Record<string, SQLInputValue>;

mkdirSync(RUNS_PATH, { recursive: true });

const db = new DatabaseSync(path.join(RUNS_PATH, "synthgen.db"));
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    run_id       TEXT PRIMARY KEY,
    model_key    TEXT NOT NULL,
    model_path   TEXT NOT NULL,
    seed         INTEGER,
    locale       TEXT,
    targets      TEXT NOT NULL,   -- JSON
    formats      TEXT NOT NULL,   -- JSON array
    status       TEXT NOT NULL,   -- RUNNING | PASS | FAIL | ERROR
    report       TEXT,            -- JSON validation report
    output_path  TEXT,
    files        TEXT,            -- JSON array of produced filenames
    error        TEXT,
    created_at   TEXT NOT NULL
  );
`);

export interface RunRecord {
  run_id: string;
  model_key: string;
  model_path: string;
  seed: number | null;
  locale: string | null;
  targets: string;
  formats: string;
  status: string;
  report: string | null;
  output_path: string | null;
  files: string | null;
  error: string | null;
  created_at: string;
}

const insertStmt = db.prepare(`
  INSERT INTO runs (run_id, model_key, model_path, seed, locale, targets, formats,
                    status, report, output_path, files, error, created_at)
  VALUES (@run_id, @model_key, @model_path, @seed, @locale, @targets, @formats,
          @status, @report, @output_path, @files, @error, @created_at)
`);

const updateStmt = db.prepare(`
  UPDATE runs SET status=@status, report=@report, output_path=@output_path,
                  files=@files, error=@error
  WHERE run_id=@run_id
`);

export function insertRun(rec: RunRecord): void {
  insertStmt.run(rec as unknown as NamedParams);
}

export function updateRun(
  run_id: string,
  patch: Partial<Pick<RunRecord, "status" | "report" | "output_path" | "files" | "error">>,
): void {
  const existing = getRun(run_id);
  if (!existing) return;
  updateStmt.run({
    run_id,
    status: patch.status ?? existing.status,
    report: patch.report ?? existing.report,
    output_path: patch.output_path ?? existing.output_path,
    files: patch.files ?? existing.files,
    error: patch.error ?? existing.error,
  } as unknown as NamedParams);
}

export function getRun(run_id: string): RunRecord | undefined {
  return db.prepare("SELECT * FROM runs WHERE run_id = ?").get(run_id) as
    | unknown as RunRecord | undefined;
}

export function listRuns(limit = 50): RunRecord[] {
  return db
    .prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as unknown as RunRecord[];
}

/** Latest PASS run for the same model + seed (for partial re-generation). */
export function findLastPassRun(modelKey: string, seed: number): RunRecord | undefined {
  return db
    .prepare(
      `SELECT * FROM runs
       WHERE model_key = ? AND seed = ? AND status = 'PASS'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(modelKey, seed) as unknown as RunRecord | undefined;
}

export default db;
