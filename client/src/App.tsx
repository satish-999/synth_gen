import { useCallback, useEffect, useMemo, useState } from "react";
import {
  downloadZip,
  fetchFamilies,
  fetchObjects,
  fetchRuns,
  generateData,
  modelWorkbookUrl,
  rerunRun,
} from "./api";
import { fetchAgentJobs } from "./api-agent";
import { FileDownloads } from "./components/FileDownloads";
import { CreateModelModal } from "./components/CreateModelModal";
import { AgentModelModal } from './components/AgentModelModal';
import { EvolveModelModal } from "./components/EvolveModelModal";
import { ModelPanel } from "./components/ModelPanel";
import { ReviewPage } from "./components/ReviewPage";
import { ObjectGrid } from "./components/ObjectGrid";
import { OptionsPanel } from "./components/OptionsPanel";
import { PipelineRail } from "./components/PipelineRail";
import { ValidationCards } from "./components/ValidationCards";
import type {
  ActiveModel,
  AgentJobSummary,
  GenerateResult,
  ModelObjects,
  OutputFormat,
  PipelineStage,
  RegistryFamily,
  RunHistoryEntry,
} from "./types";
import { modelLabel, resolveDependencies } from "./utils/dependencies";

const DEFAULT_SIZING_ROWS = 50;

const DEFAULT_ROWS: Record<string, number> = {
  category: 6,
  customer: 300,
  product: 500,
};

export default function App() {
  const [families, setFamilies] = useState<RegistryFamily[]>([]);
  const [active, setActive] = useState<ActiveModel | null>(null);
  const [objects, setObjects] = useState<ModelObjects | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Record<string, number>>({ ...DEFAULT_ROWS });
  const [seed, setSeed] = useState(42);
  const [formats, setFormats] = useState<OutputFormat[]>(["csv", "xlsx"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [stage, setStage] = useState<PipelineStage>("model");
  const [showCreate, setShowCreate] = useState(false);
  const [showAgent, setShowAgent] = useState(false);
  const [evolveMode, setEvolveMode] = useState<"UPDATE" | "REWRITE" | null>(null);
  const [reviewJobId, setReviewJobId] = useState<string | null>(null);
  const [rerunBusy, setRerunBusy] = useState<string | null>(null);
  const [historyFiles, setHistoryFiles] = useState<{
    runId: string;
    files: string[];
  } | null>(null);
  const [pendingDrafts, setPendingDrafts] = useState<AgentJobSummary[]>([]);

  const loadPendingDrafts = useCallback(async () => {
    const { jobs } = await fetchAgentJobs();
    setPendingDrafts(jobs.filter((j) => j.status === "DRAFT_READY"));
  }, []);

  const loadFamilies = useCallback(async () => {
    const { families: list } = await fetchFamilies();
    setFamilies(list);
    if (list.length > 0 && !active) {
      const f = list[0];
      setActive({ family: f.id, version: f.latestVersion, displayName: f.displayName });
    }
  }, [active]);

  useEffect(() => {
    loadFamilies().catch((e) => setError((e as Error).message));
    loadPendingDrafts().catch(() => {});
    fetchRuns()
      .then((r) => setHistory(r.runs))
      .catch(() => {});
  }, [loadFamilies, loadPendingDrafts]);

  useEffect(() => {
    if (!active) return;
    setSelected(new Set());
    setResult(null);
    setError(null);
    setStage("datasets");
    fetchObjects(active.family, active.version)
      .then(setObjects)
      .catch((e) => setError((e as Error).message));
  }, [active?.family, active?.version]);

  const picked = useMemo(() => [...selected], [selected]);

  const { added } = useMemo(() => {
    if (!objects) return { resolved: [], added: [] };
    return resolveDependencies(picked, objects.tables);
  }, [picked, objects]);

  const toggleTable = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else {
        next.add(name);
        if (objects?.tables[name]?.sizing) {
          setRows((r) => ({ ...r, [name]: r[name] ?? DEFAULT_SIZING_ROWS }));
        }
      }
      return next;
    });
    setStage("datasets");
  };

  const handleGenerate = async () => {
    if (!active || !objects || picked.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setHistoryFiles(null);
    setStage("generate");
    try {
      const rowPayload: Record<string, number> = {};
      for (const t of picked) {
        const sizing = objects.tables[t]?.sizing;
        rowPayload[t] = rows[t] ?? (sizing ? DEFAULT_SIZING_ROWS : 200);
      }
      const res = await generateData({
        family: active.family,
        version: active.version,
        tables: picked,
        rows: rowPayload,
        seed,
        locale: "en_US",
        format: formats,
      });
      setResult(res);
      setStage(res.status === "PASS" ? "files" : "validate");
      fetchRuns()
        .then((r) => setHistory(r.runs))
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message);
      setStage("validate");
    } finally {
      setLoading(false);
    }
  };

  const handleRerun = async (runId: string) => {
    setRerunBusy(runId);
    setError(null);
    setResult(null);
    setHistoryFiles(null);
    setStage("generate");
    try {
      const res = await rerunRun(runId);
      setResult(res);
      setStage(res.status === "PASS" ? "files" : "validate");
      fetchRuns()
        .then((r) => setHistory(r.runs))
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message);
      setStage("validate");
    } finally {
      setRerunBusy(null);
    }
  };

  return (
    <>
      <header>
        <h1>
          <span className="mono">SynthGen</span> · Synthetic Data Generator
        </h1>
        <p className="sub">
          Select a data model, pick datasets, generate CSV/Excel output. Every run
          is validated before any file is offered.
        </p>
      </header>

      <PipelineRail
        current={stage}
        failed={result?.status === "FAIL" || !!error}
      />

      <div className="layout">
        <ModelPanel
          families={families}
          active={active}
          pendingDrafts={pendingDrafts}
          onSelect={(family, version, displayName) => {
            setActive({ family, version, displayName });
            setStage("model");
          }}
          onCreateClick={() => setShowCreate(true)}
          onUpdateClick={() => setEvolveMode("UPDATE")}
          onRewriteClick={() => setEvolveMode("REWRITE")}
          onReviewDraft={(jobId) => setReviewJobId(jobId)}
        />

        <main className="workspace">
          <section className="card">
            <h2>Create and extend models</h2>
            <p className="hint">Turn metadata into a draft model, or add new tables to the selected model. Review every change before registering.</p>
            <button className="go" onClick={() => setShowAgent(true)}>Open model authoring agent</button>
          </section>
          {!active && (
            <section className="card">
              <p className="hint">Select a data model from the left panel.</p>
            </section>
          )}

          {active && objects && (
            <>
              <section className="card">
                <h2>
                  <span className="step">1</span>
                  Datasets — {modelLabel(active.family, active.version)}
                </h2>
                <p className="hint">
                  Select the tables to generate. Required FK parents are loaded
                  from compatible saved data.{" "}
                  <a
                    href={modelWorkbookUrl(active.family, active.version)}
                    download={`${active.family}_v${active.version}_data_model.xlsx`}
                  >
                    Open data model in Excel
                  </a>
                </p>
                {added.length > 0 && (
                  <p className="hint autonote">
                    FK parents ({added.join(", ")}) are not regenerated — reused from
                    a compatible successful run, including earlier model versions.
                  </p>
                )}
                <ObjectGrid
                  tables={objects.tables}
                  selected={selected}
                  autoIncluded={added}
                  onToggle={toggleTable}
                />
              </section>

              {picked.length > 0 && (
                <section className="card">
                  <h2>
                    <span className="step">2</span>
                    Options
                  </h2>
                  <p className="hint">
                    Row counts apply only to selected tables. For a subset run,
                    saved parent data is reused when its definition matches this
                    version. The seed controls newly generated data.
                  </p>
                  <OptionsPanel
                    picked={picked}
                    tables={objects.tables}
                    rows={rows}
                    seed={seed}
                    formats={formats}
                    onRowChange={(t, v) => {
                      setRows((r) => ({ ...r, [t]: v }));
                      setStage("options");
                    }}
                    onSeedChange={(s) => {
                      setSeed(s);
                      setStage("options");
                    }}
                    onFormatsChange={setFormats}
                  />
                </section>
              )}

              <section className="card" style={{ textAlign: "center" }}>
                <button
                  className="go"
                  type="button"
                  disabled={loading || picked.length === 0}
                  onClick={handleGenerate}
                >
                  {loading ? "Generating…" : "Generate"}
                </button>
              </section>
            </>
          )}

          {error && (
            <section className="card">
              <div className="banner bad">{error}</div>
            </section>
          )}

          {result && (
            <section className="card">
              <h2>
                <span className="step">3</span>
                Validation
              </h2>
              {result.referencedTables && result.referencedTables.length > 0 && (
                <p className="hint autonote">
                  Reused existing parent data: {result.referencedTables.join(", ")}
                  {result.referencedFromRun ? ` — from run ${result.referencedFromRun}` : ""}
                </p>
              )}
              <ValidationCards
                checks={result.compliance.checks}
                passed={result.status === "PASS"}
              />
            </section>
          )}

          {result?.status === "PASS" && (
            <section className="card">
              <h2>
                <span className="step">4</span>
                Files
              </h2>
              <p className="hint">Only selected tables are written. FK parents come from the prior run.</p>
              <FileDownloads runId={result.runId} files={result.files} />
            </section>
          )}

          {history.length > 0 && (
            <section className="card">
              <h2>Run history</h2>
              <p className="hint">
                Previous PASS runs keep their files on the server. Use Download or
                View files anytime — you do not need to regenerate.
              </p>
              <div className="preview">
                <table className="hist">
                  <thead>
                    <tr>
                      <th>run</th>
                      <th>model</th>
                      <th>seed</th>
                      <th>status</th>
                      <th>files</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice(0, 15).map((h) => {
                      const canDownload =
                        h.status === "PASS" && (h.files?.length ?? 0) > 0;
                      return (
                        <tr
                          key={h.runId}
                          className={
                            historyFiles?.runId === h.runId ? "hist-active" : undefined
                          }
                        >
                          <td>{h.runId}</td>
                          <td>{h.model}</td>
                          <td>{h.seed}</td>
                          <td>{h.status}</td>
                          <td>{h.files?.length ?? 0}</td>
                          <td>
                            <div className="hist-actions">
                              {canDownload && (
                                <>
                                  <button
                                    type="button"
                                    className="btn-secondary hist-btn"
                                    onClick={() => downloadZip(h.runId)}
                                  >
                                    Download
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary hist-btn"
                                    onClick={() => {
                                      setHistoryFiles({
                                        runId: h.runId,
                                        files: h.files ?? [],
                                      });
                                      setStage("files");
                                    }}
                                  >
                                    {historyFiles?.runId === h.runId
                                      ? "Viewing"
                                      : "View files"}
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                className="btn-secondary hist-btn"
                                disabled={rerunBusy === h.runId}
                                onClick={() => void handleRerun(h.runId)}
                              >
                                {rerunBusy === h.runId ? "…" : "Rerun"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {historyFiles && (
                <div className="history-files">
                  <h3>Files from run {historyFiles.runId}</h3>
                  <p className="hint">Zip or individual CSVs from this past run.</p>
                  <FileDownloads
                    runId={historyFiles.runId}
                    files={historyFiles.files}
                  />
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {showCreate && (
        <CreateModelModal
          onClose={() => setShowCreate(false)}
          onRegistered={(family, version, displayName) => {
            setShowCreate(false);
            void loadFamilies().then(() => {
              setActive({ family, version, displayName });
              setStage("model");
            });
          }}
        />
      )}

      {showAgent && <AgentModelModal active={active} onClose={() => setShowAgent(false)} onDraft={id => { setShowAgent(false); setReviewJobId(id); }} />}

      {evolveMode && active && (
        <EvolveModelModal
          mode={evolveMode}
          active={active}
          onClose={() => setEvolveMode(null)}
          onRevised={(family, version) => {
            setEvolveMode(null);
            void loadFamilies().then(() => {
              setActive({ family, version, displayName: active.displayName });
              setStage("model");
            });
          }}
        />
      )}

      {reviewJobId && (
        <ReviewPage
          jobId={reviewJobId}
          onClose={() => {
            setReviewJobId(null);
            loadPendingDrafts();
          }}
          onRegistered={(family, version, displayName) => {
            setReviewJobId(null);
            loadFamilies().then(() => {
              setActive({ family, version, displayName });
              loadPendingDrafts();
            });
          }}
        />
      )}
    </>
  );
}