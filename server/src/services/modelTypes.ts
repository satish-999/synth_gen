/** Shared agent model types — matches workbook contract. */

export interface ModelColumn {
  name: string;
  dtype: string;
  pk: boolean;
  fk_ref: string | null;
  fk_mode: string | null;
  cardinality: string | null;
  orphan_pct: number;
  generator: string | null;
  params: string | null;
  nullable_pct: number;
  unique: boolean;
}

export interface ModelRule {
  rule_id: string;
  object: string;
  rule_type: string;
  definition: string;
}

export interface InferredFK {
  column: string;
  fk_ref: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
}

export interface ModelViewColumn {
  name: string;
  dtype: string;
  derivation: string;
}

export interface ModelView {
  source_objects: string;
  join_logic: string | null;
  filter_logic: string | null;
  group_by: string | null;
  columns: ModelViewColumn[];
}

export interface AgentModelSpec {
  tables: Record<string, ModelColumn[]>;
  rules: ModelRule[];
  inferred_fks: InferredFK[];
  warnings: string[];
  /**
   * Optional: absent for every agent-built spec (CREATE/UPDATE/REWRITE never
   * produce views today). Only populated when a spec originates from
   * readWorkbook() on a workbook that has view sheets, or from a CSV/JSON
   * model import that declares views.
   */
  views?: Record<string, ModelView>;
}
