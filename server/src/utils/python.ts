import { spawn, type ChildProcess } from "node:child_process";
import { resolvePython } from "../config.js";

export interface PyResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** true when the run was stopped because it exceeded timeoutMs */
  timedOut: boolean;
  /** true when cancel() was called */
  cancelled: boolean;
  /** true when output exceeded maxOutputBytes and was trimmed */
  truncated: boolean;
  /** wall-clock duration in milliseconds */
  durationMs: number;
}

export interface PyOptions {
  cwd?: string;
  /** hard limit on wall-clock runtime; default 15 minutes */
  timeoutMs?: number;
  /** cap on captured stdout+stderr; default 5 MB */
  maxOutputBytes?: number;
  /** extra environment variables for the child */
  env?: NodeJS.ProcessEnv;
  /** called with each chunk of stdout, for progress reporting */
  onStdout?: (chunk: string) => void;
  /** called with each chunk of stderr */
  onStderr?: (chunk: string) => void;
  /** receives a cancel function as soon as the child starts */
  onStart?: (handle: PyHandle) => void;
}

export interface PyHandle {
  pid: number | undefined;
  cancel: () => void;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.PYTHON_TIMEOUT_MS ?? 15 * 60 * 1000);
const DEFAULT_MAX_OUTPUT = Number(process.env.PYTHON_MAX_OUTPUT_BYTES ?? 5 * 1024 * 1024);
/** grace period between SIGTERM and SIGKILL */
const KILL_GRACE_MS = 5_000;

/**
 * Bounded buffer: keeps the head and the tail of a stream, which is what is
 * actually useful for diagnosis, and drops the middle once the cap is reached.
 * The previous implementation concatenated every chunk with no limit, so a
 * runaway script could exhaust the server's memory.
 */
class BoundedBuffer {
  private head: string[] = [];
  private tail: string[] = [];
  private headBytes = 0;
  private tailBytes = 0;
  truncated = false;

  constructor(private readonly limit: number) {}

  push(chunk: string): void {
    const size = Buffer.byteLength(chunk);
    if (this.headBytes + size <= this.limit / 2) {
      this.head.push(chunk);
      this.headBytes += size;
      return;
    }
    this.truncated = true;
    this.tail.push(chunk);
    this.tailBytes += size;
    while (this.tailBytes > this.limit / 2 && this.tail.length > 1) {
      const dropped = this.tail.shift() as string;
      this.tailBytes -= Buffer.byteLength(dropped);
    }
  }

  toString(): string {
    if (!this.truncated) return this.head.join("");
    return (
      this.head.join("") +
      `\n... [output truncated: exceeded ${this.limit} bytes] ...\n` +
      this.tail.join("")
    );
  }
}

/** Terminate a child and everything it spawned, escalating if it ignores SIGTERM. */
function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32" && child.pid) {
      // Windows has no process groups: taskkill removes the whole tree
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
      });
    } else {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, KILL_GRACE_MS).unref();
    }
  } catch {
    /* the process already exited */
  }
}

/**
 * Run a Python script. Never rejects on a non-zero exit code; inspect
 * result.code, result.timedOut and result.cancelled instead. Rejects only when
 * the interpreter itself cannot be started.
 *
 * Backwards compatible with the old three-argument form:
 *     runPython(script, args, cwd)
 */
export function runPython(
  scriptPath: string,
  args: string[],
  cwdOrOptions?: string | PyOptions,
): Promise<PyResult> {
  const opts: PyOptions =
    typeof cwdOrOptions === "string" ? { cwd: cwdOrOptions } : cwdOrOptions ?? {};

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutput = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const python = resolvePython();
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(python, [scriptPath, ...args], {
        cwd: opts.cwd,
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: "1", ...opts.env },
        // detached on POSIX gives the child its own group, so a kill reaches
        // anything it spawned
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      reject(err);
      return;
    }

    const stdout = new BoundedBuffer(maxOutput);
    const stderr = new BoundedBuffer(maxOutput);
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, timeoutMs);
    timer.unref();

    const handle: PyHandle = {
      pid: child.pid,
      cancel: () => {
        cancelled = true;
        terminate(child);
      },
    };
    opts.onStart?.(handle);

    child.stdout?.on("data", (d: Buffer) => {
      const text = d.toString();
      stdout.push(text);
      opts.onStdout?.(text);
    });
    child.stderr?.on("data", (d: Buffer) => {
      const text = d.toString();
      stderr.push(text);
      opts.onStderr?.(text);
    });

    const settle = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      let errText = stderr.toString();
      if (timedOut) {
        errText += `\n[runPython] terminated after exceeding the ${timeoutMs} ms limit.`;
      }
      if (cancelled) {
        errText += "\n[runPython] cancelled by the server.";
      }

      resolve({
        code,
        stdout: stdout.toString(),
        stderr: errText,
        timedOut,
        cancelled,
        truncated: stdout.truncated || stderr.truncated,
        durationMs: Date.now() - startedAt,
      });
    };

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => settle(code));
  });
}
