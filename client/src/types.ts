export interface RegistryFamily {
  id: string;
  displayName: string;
  latestVersion: number;
  versions: number[];
  createdAt: string;
}

export interface TableInfo {
  pk: string[];
  sizing: boolean;
  parents: string[];
}

export interface ModelObjects {
  family: string;
  version: number;
  tables: Record<string, TableInfo>;
  views: string[];
}

export interface ComplianceCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface GenerateResult {
  runId: string;
  status: "PASS" | "FAIL" | "ERROR";
  family: string;
  version: number;
  autoIncluded: string[];
  referencedTables?: string[];
  referencedFromRun?: string | null;
  targets: Record<string, { rows: number | "derived" }>;
  compliance: { passed: boolean; checks: ComplianceCheck[] };
  files: string[];
  error?: string;
}

export type OutputFormat = "csv" | "xlsx";

export type PipelineStage = "model" | "datasets" | "options" | "generate" | "validate" | "files";

export interface ActiveModel {
  family: string;
  version: number;
  displayName: string;
}

export interface RunHistoryEntry {
  runId: string;
  model: string;
  seed: number;
  status: string;
  files: string[];
  targets?: Record<string, { rows: number | "derived" }>;
  formats?: string[];
  createdAt: string;
}

export interface InferredFK {
  column: string;
  fk_ref: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
}

export interface EnrichedDiff {
  mode: string;
  summary: {
    addedTables: number;
    addedViews: number;
    addedRules: number;
    inferredFks: number;
    modifiedTables: number;
  };
  tables: Array<{
    name: string;
    columns: number;
    pk: string | null;
    parents: string[];
    sizing: boolean;
    isNew: boolean;
  }>;
  inferred_fks: InferredFK[];
  added_rules: Array<{ rule_id: string; object: string; rule_type: string; definition: string }>;
  modified_tables: string[];
  unchanged_tables: string[];
  removed_tables?: string[];
  requiresFkReview: boolean;
}

export interface AgentJobSummary {
  jobId: string;
  mode: string;
  familyId: string;
  displayName: string;
  baseVersion?: number | null;
  status: string;
  agentSource?: string;
  createdAt: string;
}

export interface AgentJob {
  jobId: string;
  mode: string;
  familyId: string;
  displayName: string;
  baseVersion?: number | null;
  status: string;
  agentSource?: string;
  manifest?: {
    tables: Record<string, { columns: number; pk: string | null }>;
    inferred_fks: InferredFK[];
    warnings: string[];
  };
  diff?: unknown;
  enrichedDiff?: EnrichedDiff;
  schemaFiles?: string[];
  error?: string;
  createdAt: string;
  completedAt?: string;
}
