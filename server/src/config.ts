import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// repo root = server/src/.. -> server/.. -> repo
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

function fromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
}

export const ENGINE_DIR = fromRoot(process.env.ENGINE_DIR ?? "engine");
export const REGISTRY_PATH = fromRoot(process.env.REGISTRY_PATH ?? "registry");
export const RUNS_PATH = fromRoot(process.env.RUNS_PATH ?? "runs");
export const UPLOADS_PATH = fromRoot(process.env.UPLOADS_PATH ?? "uploads");
export const DRAFTS_PATH = fromRoot(process.env.DRAFTS_PATH ?? "uploads/drafts");
export const PORT = Number(process.env.PORT ?? 3000);
export const HOST = process.env.HOST ?? "127.0.0.1";
export const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
export const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER ?? "";
export const BASIC_AUTH_PASS = process.env.BASIC_AUTH_PASS ?? "";
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
export const DEFAULT_PARENT_ROWS = Number(process.env.DEFAULT_PARENT_ROWS ?? 100);

/** Resolve the Python interpreter: explicit env, else engine venv, else `py`/`python`. */
export function resolvePython(): string {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;

  const venvWin = path.join(ENGINE_DIR, ".venv", "Scripts", "python.exe");
  const venvNix = path.join(ENGINE_DIR, ".venv", "bin", "python");
  if (existsSync(venvWin)) return venvWin;
  if (existsSync(venvNix)) return venvNix;

  return process.platform === "win32" ? "py" : "python3";
}

export const SYNTHGEN = path.join(ENGINE_DIR, "synthgen.py");
export const VALIDATE = path.join(ENGINE_DIR, "validate_compliance.py");
export const VALIDATE_MODEL = path.join(ENGINE_DIR, "validate_model.py");
export const MODEL_OBJECTS = path.join(ENGINE_DIR, "model_objects.py");
