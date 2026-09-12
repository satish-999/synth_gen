import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { RUNS_PATH } from "../config.js";

type NamedParams = Record<string, SQLInputValue>;

mkdirSync(RUNS_PATH, { recursive: true });

const db = new DatabaseSync(path.join(RUNS_PATH, "synthgen.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_jobs (
    job_id        TEXT PRIMARY KEY,
    mode          TEXT NOT NULL,
    family_id     TEXT,
    display_name  TEXT,
    base_version  INTEGER,
    status        TEXT NOT NULL,
    draft_path    TEXT,
    manifest      TEXT,
    diff          TEXT,
    schema_files  TEXT,
    error         TEXT,
    agent_source  TEXT,
    created_at    TEXT NOT NULL,
    completed_at  TEXT
  );
`);

export type AgentJobStatus =
  | "PENDING"
  | "RUNNING"
  | "DRAFT_READY"
  | "FAILED"
  | "APPROVED"
  | "REJECTED";

export interface AgentJobRecord {
  job_id: string;
  mode: string;
  family_id: string | null;
  display_name: string | null;
  base_version: number | null;
  status: AgentJobStatus;
  draft_path: string | null;
  manifest: string | null;
  diff: string | null;
  schema_files: string;
  error: string | null;
  agent_source: string | null;
  created_at: string;
  completed_at: string | null;
}

export function insertAgentJob(rec: AgentJobRecord): void {
  db.prepare(`
    INSERT INTO agent_jobs (job_id, mode, family_id, display_name, base_version, status,
      draft_path, manifest, diff, schema_files, error, agent_source, created_at, completed_at)
    VALUES (@job_id, @mode, @family_id, @display_name, @base_version, @status,
      @draft_path, @manifest, @diff, @schema_files, @error, @agent_source, @created_at, @completed_at)
  `).run(rec as unknown as NamedParams);
}

export function updateAgentJob(
  job_id: string,
  patch: Partial<
    Pick<
      AgentJobRecord,
      "status" | "draft_path" | "manifest" | "diff" | "error" | "agent_source" | "completed_at"
    >
  >,
): void {
  const existing = getAgentJob(job_id);
  if (!existing) return;
  db.prepare(`
    UPDATE agent_jobs SET
      status = @status,
      draft_path = @draft_path,
      manifest = @manifest,
      diff = @diff,
      error = @error,
      agent_source = @agent_source,
      completed_at = @completed_at
    WHERE job_id = @job_id
  `).run({
    job_id,
    status: patch.status ?? existing.status,
    draft_path: patch.draft_path ?? existing.draft_path,
    manifest: patch.manifest ?? existing.manifest,
    diff: patch.diff ?? existing.diff,
    error: patch.error ?? existing.error,
    agent_source: patch.agent_source ?? existing.agent_source,
    completed_at: patch.completed_at ?? existing.completed_at,
  } as unknown as NamedParams);
}

export function getAgentJob(job_id: string): AgentJobRecord | undefined {
  return db.prepare("SELECT * FROM agent_jobs WHERE job_id = ?").get(job_id) as
    | unknown as AgentJobRecord | undefined;
}

export function listAgentJobs(limit = 20): AgentJobRecord[] {
  return db
    .prepare("SELECT * FROM agent_jobs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as unknown as AgentJobRecord[];
}
