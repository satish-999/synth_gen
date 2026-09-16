import { useState } from "react";
import { modelAuthoringGuideUrl, modelTemplateUrl, registerDataModel, ModelImportError } from "../api";

interface Props {
  onClose: () => void;
  onRegistered: (family: string, version: number, displayName: string) => void;
}

export function CreateModelModal({ onClose, onRegistered }: Props) {
  const [familyId, setFamilyId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !familyId.trim()) return;
    setBusy(true);
    setError(null);
    setFieldErrors([]);

    const form = new FormData();
    form.append("familyId", familyId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_"));
    form.append("displayName", displayName.trim() || familyId.trim());
    form.append("workbook", file);

    try {
      const res = await registerDataModel(form);
      onRegistered(res.family, res.version, displayName.trim() || familyId.trim());
      onClose();
    } catch (err) {
      if (err instanceof ModelImportError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import data model</h2>
        <p className="hint">
          Upload a complete data <strong>model</strong> — every table, column, generator, rule and view —
          as an <strong>.xlsx</strong> workbook, or as a single <strong>.csv</strong> or <strong>.json</strong> file
          in the same shape. This is the finished model itself, not raw table metadata for the authoring
          agent to design one from. The engine validates PKs, FKs, and generators before registering v1.
        </p>
        <p className="hint">
          <a href={modelTemplateUrl()} download="data_model_TEMPLATE.xlsx">
            Download the authoring template (.xlsx)
          </a>
          {" · "}
          <a href={modelAuthoringGuideUrl()} download="DATA_MODEL_AUTHORING_GUIDE.md">
            authoring guide
          </a>
          {" · "}
          <a href="/docs/CSV_JSON_MODEL_FORMAT.md" target="_blank" rel="noreferrer">
            CSV/JSON format reference
          </a>
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            Family ID (slug)
            <input value={familyId} onChange={(e) => setFamilyId(e.target.value)} placeholder="procurement" required />
          </label>
          <label>
            Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Procurement Demo" />
          </label>
          <label>
            Data model file (.xlsx, .xls, .csv or .json)
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </label>

          {error && (
            <div className="banner bad" role="alert">
              {error}
              {fieldErrors.length > 1 && (
                <ul>
                  {fieldErrors.map((fe, i) => <li key={i}>{fe}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="go" disabled={busy || !file}>
              {busy ? "Validating…" : "Register model (v1)"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
