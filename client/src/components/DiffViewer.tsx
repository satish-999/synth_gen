import type { EnrichedDiff, InferredFK } from "../types";

interface Props {
  diff: EnrichedDiff;
  confirmedFks: Set<string>;
  onToggleFk: (column: string) => void;
}

function FkRow({ fk, confirmed, onToggle }: { fk: InferredFK; confirmed: boolean; onToggle: () => void }) {
  const conf = fk.confidence.toLowerCase();
  return (
    <label className={`fk-row fk-${conf}${confirmed ? " confirmed" : ""}`}>
      <input type="checkbox" checked={confirmed} onChange={onToggle} />
      <div>
        <div className="fk-main">
          <span className="fk-col">{fk.column}</span>
          <span className="fk-arrow">→</span>
          <span className="fk-ref">{fk.fk_ref}</span>
          <span className={`fk-badge ${conf}`}>{fk.confidence}</span>
        </div>
        <div className="fk-reason">{fk.reason}</div>
      </div>
    </label>
  );
}

export function DiffViewer({ diff, confirmedFks, onToggleFk }: Props) {
  return (
    <div className="diff-viewer">
      <div className="diff-summary">
        <span className="diff-chip">+{diff.summary.addedTables} tables</span>
        <span className="diff-chip">+{diff.summary.addedRules} rules</span>
        {diff.summary.inferredFks > 0 && (
          <span className="diff-chip amber">⚠ {diff.summary.inferredFks} inferred FKs</span>
        )}
        <span className="diff-chip mode">{diff.mode}</span>
      </div>

      <section className="diff-section">
        <h3>Added tables</h3>
        <div className="diff-table-grid">
          {diff.tables.filter((t) => t.isNew).map((t) => (
            <div key={t.name} className="diff-table-card new">
              <div className="diff-table-name">{t.name}</div>
              <div className="diff-table-meta">
                {t.columns} columns · PK: {t.pk ?? "—"}
                {t.sizing && " · SIZING"}
              </div>
              {t.parents.length > 0 && (
                <div className="diff-table-meta">FK parents: {t.parents.join(", ")}</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {diff.inferred_fks.length > 0 && (
        <section className="diff-section fk-section">
          <h3>Inferred foreign keys — confirm each one</h3>
          <p className="hint">
            Wrong FKs silently corrupt generated data. Check each relationship before registering.
          </p>
          <div className="fk-rows">
            {diff.inferred_fks.map((fk) => (
              <FkRow
                key={fk.column}
                fk={fk}
                confirmed={confirmedFks.has(fk.column)}
                onToggle={() => onToggleFk(fk.column)}
              />
            ))}
          </div>
        </section>
      )}

      {diff.added_rules.length > 0 && (
        <section className="diff-section">
          <h3>Added rules</h3>
          <ul className="rule-list">
            {diff.added_rules.map((r) => (
              <li key={r.rule_id}>
                <strong>{r.rule_id}</strong> ({r.object}) — {r.rule_type}: {r.definition}
              </li>
            ))}
          </ul>
        </section>
      )}

      {diff.modified_tables.length > 0 && (
        <section className="diff-section">
          <h3>Modified tables</h3>
          <ul className="draft-tables">
            {diff.modified_tables.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      {diff.removed_tables && diff.removed_tables.length > 0 && (
        <section className="diff-section">
          <h3>Removed tables</h3>
          <ul className="draft-tables">
            {diff.removed_tables.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
