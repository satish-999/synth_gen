import { useState } from "react";
import { reviseDataModel } from "../api";
import type { ActiveModel } from "../types";

type EvolveMode = "UPDATE" | "REWRITE";

interface Props {
  mode: EvolveMode;
  active: ActiveModel;
  onClose: () => void;
  onRevised: (family: string, version: number) => void;
}

export function EvolveModelModal({ mode, active, onClose, onRevised }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);

    const form = new FormData();
    form.append("mode", mode);
    form.append("workbook", file);

    try {
      const res = await reviseDataModel(active.family, active.version, form);
      onRevised(res.family, res.version);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "UPDATE" ? "Upload updated data model" : "Rewrite data model";
  const hint =
    mode === "UPDATE"
      ? `Upload your edited data_model.xlsx. Registers as v${active.version + 1} after validation.`
      : `Upload a full replacement workbook. v${active.version} stays unchanged; v${active.version + 1} becomes active after validation.`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="hint">{hint}</p>
        <p className="hint">
          Base: <strong>{active.family}</strong> v{active.version} → new v{active.version + 1}
        </p>
        <p className="hint">
          Tip: download the current model from the left panel, edit in Excel, then upload here.
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            Data model workbook (.xlsx)
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </label>

          {error && <div className="banner bad">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="go" disabled={busy || !file}>
              {busy ? "Validating…" : `Register v${active.version + 1}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
