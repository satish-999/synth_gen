import type { AgentJob, AgentJobSummary } from "./types";

export function createAgentJob(form: FormData): Promise<{ jobId: string; status: string }> {
  return fetch("/api/agent/jobs", { method: "POST", body: form }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? "Upload failed");
    }
    return res.json();
  });
}

export function fetchAgentJobs(): Promise<{ jobs: AgentJobSummary[] }> {
  return fetch("/api/agent/jobs").then((r) => r.json());
}

export function fetchAgentJob(jobId: string): Promise<AgentJob> {
  return fetch(`/api/agent/jobs/${jobId}`).then(async (res) => {
    if (!res.ok) throw new Error("Job not found");
    return res.json();
  });
}

export function approveAgentJob(
  jobId: string,
  body: { reviewAcknowledged: boolean; confirmedFks: string[] },
): Promise<{ modelKey: string; family: string; version: number }> {
  return fetch(`/api/agent/jobs/${jobId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? "Approve failed");
    }
    return res.json();
  });
}

export function rejectAgentJob(jobId: string): Promise<void> {
  return fetch(`/api/agent/jobs/${jobId}/reject`, { method: "POST" }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? "Reject failed");
    }
  });
}

export function uploadEditedDraft(jobId: string, file: File): Promise<AgentJob> {
  const form = new FormData();
  form.append("workbook", file);
  return fetch(`/api/agent/jobs/${jobId}/draft`, { method: "PUT", body: form }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? "Upload failed");
    }
    return res.json();
  });
}

export function downloadDraft(jobId: string): void {
  window.location.href = `/api/agent/jobs/${jobId}/draft`;
}
