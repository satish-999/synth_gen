import { spawn } from "node:child_process";
import { resolvePython } from "../config.js";

export interface PyResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run a Python script and capture stdout/stderr. Never rejects on non-zero exit. */
export function runPython(scriptPath: string, args: string[], cwd?: string): Promise<PyResult> {
  const python = resolvePython();
  return new Promise((resolve, reject) => {
    const child = spawn(python, [scriptPath, ...args], {
      cwd,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
