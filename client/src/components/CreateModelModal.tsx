import { useState } from "react";
import { modelTemplateUrl, registerDataModel } from "../api";

interface Props {
  onClose: () => void;
  onRegistered: (family: string, version: number, displayName: string) => void;
}

export function CreateModelModal({ onClose, onRegistered }: Props) {
  const [familyId, setFamilyId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !familyId.trim()) return;
    setBusy(true);
    setError(null);

    const form = new FormData();
    form.append("familyId", familyId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_"));
    form.append("displayName", displayName.trim() || familyId.trim());
    form.append("workbook", file);

    try {
      const res = await registerDataModel(form);
      onRegistered(res.family, res.version, displayName.trim() || familyId.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import data model</h2>
        <p className="hint">
          Upload a complete <strong>data_model.xlsx</strong> workbook (with <code>_OBJECTS</code>, table sheets,
          and <code>_RULES</code>). The engine validates PKs, FKs, and generators before registering v1.
        </p>
        <p className="hint">
          <a href={modelTemplateUrl()} download="data_model_template.xlsx">
            Download reference template
          </a>
          {" "}(from Design docs)
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
              {busy ? "Validating…" : "Register model (v1)"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
