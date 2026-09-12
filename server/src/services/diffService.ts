export interface InferredFK {
  column: string;
  fk_ref: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
}

export interface ModelRule {
  rule_id: string;
  object: string;
  rule_type: string;
  definition: string;
}

export interface AgentDiff {
  mode: string;
  added_tables: string[];
  added_views: string[];
  added_rules: ModelRule[];
  inferred_fks: InferredFK[];
  modified_tables: string[];
  unchanged_tables: string[];
  removed_tables?: string[];
}

export interface EnrichedTable {
  name: string;
  columns: number;
  pk: string | null;
  parents: string[];
  sizing: boolean;
  isNew: boolean;
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
  tables: EnrichedTable[];
  inferred_fks: InferredFK[];
  added_rules: ModelRule[];
  modified_tables: string[];
  unchanged_tables: string[];
  removed_tables: string[];
  requiresFkReview: boolean;
}

export function enrichDiff(
  diff: AgentDiff,
  manifest: {
    tables?: Record<string, { columns: number; pk: string | null }>;
    inferred_fks?: InferredFK[];
  } | null,
  objects?: { tables: Record<string, { pk: string[]; sizing: boolean; parents: string[] }> } | null,
): EnrichedDiff {
  const addedSet = new Set(diff.added_tables ?? []);
  const tables: EnrichedTable[] = Object.keys(manifest?.tables ?? {}).map((name) => ({
    name,
    columns: manifest!.tables![name].columns,
    pk: manifest!.tables![name].pk,
    parents: objects?.tables[name]?.parents ?? [],
    sizing: objects?.tables[name]?.sizing ?? false,
    isNew: addedSet.has(name),
  }));

  const inferred_fks = diff.inferred_fks ?? manifest?.inferred_fks ?? [];

  return {
    mode: diff.mode,
    summary: {
      addedTables: diff.added_tables?.length ?? 0,
      addedViews: diff.added_views?.length ?? 0,
      addedRules: diff.added_rules?.length ?? 0,
      inferredFks: inferred_fks.length,
      modifiedTables: diff.modified_tables?.length ?? 0,
    },
    tables,
    inferred_fks,
    added_rules: diff.added_rules ?? [],
    modified_tables: diff.modified_tables ?? [],
    unchanged_tables: diff.unchanged_tables ?? [],
    removed_tables: diff.removed_tables ?? [],
    requiresFkReview: inferred_fks.length > 0,
  };
}
