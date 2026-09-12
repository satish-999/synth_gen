import type {
  GenerateResult,
  ModelObjects,
  RegistryFamily,
  RunHistoryEntry,
} from "./types";

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
  return "/api/models/template";
}

export async function registerDataModel(form: FormData): Promise<{
  family: string;
  version: number;
  modelKey: string;
  tableCount: number;
}> {
  const res = await fetch("/api/models/register", { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Registration failed");
  }
  return res.json() as Promise<{
    family: string;
    version: number;
    modelKey: string;
    tableCount: number;
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
}> {
  const res = await fetch(`/api/models/${family}/${baseVersion}/revise`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Revision failed");
  }
  return res.json() as Promise<{
    family: string;
    version: number;
    modelKey: string;
    baseVersion: number;
    tableCount: number;
  }>;
}
