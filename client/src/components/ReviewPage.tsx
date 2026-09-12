import { useEffect, useRef, useState } from "react";
import {
  approveAgentJob,
  downloadDraft,
  fetchAgentJob,
  rejectAgentJob,
  uploadEditedDraft,
} from "../api-agent";
import type { AgentJob } from "../types";
import { DiffViewer } from "./DiffViewer";

interface Props {
  jobId: string;
  onClose: () => void;
  onRegistered: (family: string, version: number, displayName: string) => void;
}

export function ReviewPage({ jobId, onClose, onRegistered }: Props) {
  const [job, setJob] = useState<AgentJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmedFks, setConfirmedFks] = useState<Set<string>>(new Set());
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const j = await fetchAgentJob(jobId);
    setJob(j);
    return j;
  };

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [jobId]);

  const toggleFk = (col: string) => {
    setConfirmedFks((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  const allFksConfirmed =
    !job?.enrichedDiff?.inferred_fks.length ||
    job.enrichedDiff.inferred_fks.every((fk) => confirmedFks.has(fk.column));

  const canApprove = reviewAcknowledged && allFksConfirmed && job?.status === "DRAFT_READY";

  const nextVersion =
    job?.mode === "CREATE" ? 1 : job?.baseVersion != null ? job.baseVersion + 1 : 1;

  const handleApprove = async () => {
    if (!job || !canApprove) return;
    setBusy(true);
    setError(null);
    try {
      const res = await approveAgentJob(job.jobId, {
        reviewAcknowledged: true,
        confirmedFks: [...confirmedFks],
      });
      onRegistered(res.family, res.version, job.displayName);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    setBusy(true);
    try {
      await rejectAgentJob(jobId);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUploadEdited = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const j = await uploadEditedDraft(jobId, file);
      setJob(j);
      setConfirmedFks(new Set());
      setReviewAcknowledged(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!job) {
    return (
      <div className="review-overlay">
        <div className="review-panel">
          <p className="hint">Loading draft for review…</p>
          {error && <div className="banner bad">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="review-overlay">
      <div className="review-panel">
        <header className="review-header">
          <div>
            <h2>Review draft — {job.displayName}</h2>
            <p className="hint">
              {job.familyId} · {job.mode}
              {job.baseVersion != null ? ` · v${job.baseVersion} → v${nextVersion}` : ""}
              {" · "}{job.agentSource ?? "agent"} · {job.status}
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </header>

        {job.manifest?.warnings?.map((w) => (
          <div key={w} className="banner amber-banner">{w}</div>
        ))}

        {job.enrichedDiff && (
          <DiffViewer
            diff={job.enrichedDiff}
            confirmedFks={confirmedFks}
            onToggleFk={toggleFk}
          />
        )}

        <section className="review-actions-section">
          <h3>Edit draft (optional)</h3>
          <p className="hint">
            Download the workbook, edit in Excel, then re-upload. The server re-validates before you can register.
          </p>
          <div className="review-edit-row">
            <button type="button" className="btn-secondary" onClick={() => downloadDraft(job.jobId)}>
              Download draft .xlsx
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUploadEdited(f);
              }}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              Upload edited workbook
            </button>
          </div>
        </section>

        <section className="review-confirm-section">
          <label className="confirm-row">
            <input
              type="checkbox"
              checked={reviewAcknowledged}
              onChange={(e) => setReviewAcknowledged(e.target.checked)}
            />
            I have reviewed this draft and confirm PKs, FKs, generators, and rules are correct.
          </label>
          {!allFksConfirmed && job.enrichedDiff?.inferred_fks.length ? (
            <p className="hint fk-warning">
              Confirm all {job.enrichedDiff.inferred_fks.length} inferred FK(s) above before registering.
            </p>
          ) : null}
        </section>

        {error && <div className="banner bad">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={handleReject}>
            Reject draft
          </button>
          <button type="button" className="go" disabled={busy || !canApprove} onClick={handleApprove}>
            Register model (v{nextVersion})
          </button>
        </div>
      </div>
    </div>
  );
}
