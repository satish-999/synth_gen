import type {
  GenerateResult,
  ModelObjects,
  RegistryFamily,
  RunHistoryEntry,
} from "./types";

/** Thrown by registerDataModel/reviseDataModel on a 400 with per-field
 * detail (a rejected CSV/JSON data model). `fieldErrors` is the full list;
 * `message` is a one-line summary suitable as a fallback. */
export class ModelImportError extends Error {
  fieldErrors: string[];
  constructor(message: string, fieldErrors: string[]) {
    super(message);
    this.name = "ModelImportError";
    this.fieldErrors = fieldErrors;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export function fetchFamilies(): Promise<{ families: RegistryFamily[] }> {
  return api("/api/models");
}

export function fetchObjects(family: string, version: number): Promise<ModelObjects> {
  return api(`/api/models/${family}/${version}/objects`);
}

export function generateData(body: {
  family: string;
  version: number;
  tables: string[];
  rows: Record<string, number>;
  seed: number;
  locale: string;
  format: string[];
}): Promise<GenerateResult> {
  return api("/api/generate", { method: "POST", body: JSON.stringify(body) });
}

export function fetchRuns(): Promise<{ runs: RunHistoryEntry[] }> {
  return api("/api/runs");
}

export function rerunRun(runId: string): Promise<GenerateResult> {
  return api(`/api/runs/${runId}/rerun`, { method: "POST" });
}

export function downloadZip(runId: string): void {
  window.location.href = `/api/generate/${runId}/download`;
}

export function downloadFile(runId: string, name: string): void {
  window.location.href = `/api/generate/${runId}/files/${encodeURIComponent(name)}`;
}

export function modelWorkbookUrl(family: string, version: number): string {
  return `/api/models/${family}/${version}/download`;
}

export function modelTemplateUrl(): string {
  return "/templates/data_model_TEMPLATE.xlsx";
}

export function modelAuthoringGuideUrl(): string {
  return "/templates/DATA_MODEL_AUTHORING_GUIDE.md";
}

/** The same `payment` table across all four metadata formats the authoring
 * agent accepts — for the model-authoring agent's file upload, not "Import
 * data model" (see docs/CSV_JSON_MODEL_FORMAT.md for that distinction). */
export function metadataSampleUrls(): { label: string; url: string }[] {
  return [
    { label: "SQL (payment.sql)", url: "/templates/payment.sql" },
    { label: "Markdown (retail_add_payment_metadata.md)", url: "/templates/retail_add_payment_metadata.md" },
    { label: "CSV (payment.csv)", url: "/templates/payment.csv" },
    { label: "JSON (payment.json)", url: "/templates/payment.json" },
  ];
}

async function throwModelImportError(res: Response, fallback: string): Promise<never> {
  const err = await res.json().catch(() => ({ error: res.statusText }));
  const e = err as { error?: string; fieldErrors?: string[] };
  if (e.fieldErrors?.length) throw new ModelImportError(e.error ?? fallback, e.fieldErrors);
  throw new Error(e.error ?? fallback);
}

export async function registerDataModel(form: FormData): Promise<{
  family: string;
  version: number;
  modelKey: string;
  tableCount: number;
  viewCount: number;
}> {
  const res = await fetch("/api/models/register", { method: "POST", body: form });
  if (!res.ok) return throwModelImportError(res, "Registration failed");
  return res.json() as Promise<{
    family: string;
    version: number;
    modelKey: string;
    tableCount: number;
    viewCount: number;
  }>;
}

export async function reviseDataModel(
  family: string,
  baseVersion: number,
  form: FormData,
): Promise<{
  family: string;
  version: number;
  modelKey: string;
  baseVersion: number;
  tableCount: number;
  viewCount: number;
}> {
  const res = await fetch(`/api/models/${family}/${baseVersion}/revise`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) return throwModelImportError(res, "Revision failed");
  return res.json() as Promise<{
    family: string;
    version: number;
    modelKey: string;
    baseVersion: number;
    tableCount: number;
    viewCount: number;
  }>;
}
