import type { ActiveModel, AgentJobSummary, RegistryFamily } from "../types";
import { modelWorkbookUrl } from "../api";
import { modelLabel } from "../utils/dependencies";

interface Props {
  families: RegistryFamily[];
  active: ActiveModel | null;
  pendingDrafts: AgentJobSummary[];
  onSelect: (family: string, version: number, displayName: string) => void;
  onCreateClick: () => void;
  onUpdateClick: () => void;
  onRewriteClick: () => void;
  onReviewDraft: (jobId: string) => void;
}

export function ModelPanel({
  families,
  active,
  pendingDrafts,
  onSelect,
  onCreateClick,
  onUpdateClick,
  onRewriteClick,
  onReviewDraft,
}: Props) {
  return (
    <aside className="model-panel">
      <h2>Data Models</h2>
      <p className="panel-hint">
        Import a data_model.xlsx, generate data, or download and edit in Excel to upload a new version.
      </p>

      {pendingDrafts.length > 0 && (
        <div className="pending-drafts">
          <h3>Pending review (legacy agent)</h3>
          <ul className="model-list">
            {pendingDrafts.map((j) => (
              <li key={j.jobId}>
                <button type="button" className="model-item draft-item" onClick={() => onReviewDraft(j.jobId)}>
                  <span className="model-name">{j.displayName}</span>
                  <span className="model-ver draft">review</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="model-list">
        {families.flatMap((f) =>
          f.versions.map((v) => {
            const isActive = active?.family === f.id && active?.version === v;
            return (
              <li key={`${f.id}-${v}`} className="model-row">
                <button
                  type="button"
                  className={`model-item${isActive ? " active" : ""}`}
                  onClick={() => onSelect(f.id, v, f.displayName)}
                >
                  <span className="model-name">{f.displayName}</span>
                  <span className="model-ver">v{v}</span>
                </button>
                <a
                  className="model-excel-link"
                  href={modelWorkbookUrl(f.id, v)}
                  download={`${f.id}_v${v}_data_model.xlsx`}
                  title="Download / open in Excel"
                  onClick={(e) => e.stopPropagation()}
                >
                  Excel
                </a>
              </li>
            );
          }),
        )}
      </ul>

      {active && (
        <div className="active-badge">
          Active: <strong>{modelLabel(active.family, active.version)}</strong>
          <a
            className="btn-excel-active"
            href={modelWorkbookUrl(active.family, active.version)}
            download={`${active.family}_v${active.version}_data_model.xlsx`}
          >
            Open in Excel
          </a>
        </div>
      )}

      <div className="model-actions">
        <button type="button" className="btn-create" onClick={onCreateClick}>
          + Import data model
        </button>
        <button type="button" disabled={!active} onClick={onUpdateClick} title={active ? "Upload edited workbook" : "Select a model first"}>
          Upload new version
        </button>
        <button type="button" disabled={!active} onClick={onRewriteClick} title={active ? "Replace with new workbook" : "Select a model first"}>
          Rewrite model
        </button>
      </div>
    </aside>
  );
}
