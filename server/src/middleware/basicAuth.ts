import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { BASIC_AUTH_PASS, BASIC_AUTH_USER } from "../config.js";

/**
 * HTTP Basic Auth.
 *
 * Previous behaviour: if either credential was unset the middleware called
 * next(), so a missing environment variable silently published every route.
 * That is fine on a laptop and unacceptable once the service is reachable from
 * the internet.
 *
 * Now:
 *   - credentials configured        -> enforced on every protected route
 *   - credentials missing, dev      -> allowed, with a warning at startup
 *   - credentials missing, prod     -> every request refused (503), and
 *                                      assertAuthConfigured() stops the server
 *                                      from starting at all
 *   - /api/health                   -> always public, so container and load
 *                                      balancer probes work without secrets
 *
 * Set ALLOW_ANONYMOUS=true to run without auth deliberately (local demos).
 */

const PUBLIC_PATHS = new Set(["/api/health"]);

const isProduction = (): boolean => process.env.NODE_ENV === "production";
const anonymousAllowed = (): boolean =>
  String(process.env.ALLOW_ANONYMOUS ?? "").toLowerCase() === "true";
const credentialsConfigured = (): boolean =>
  Boolean(BASIC_AUTH_USER && BASIC_AUTH_PASS);

/** Constant-time compare that does not leak length through early return. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // still perform a comparison so timing does not reveal the length
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function challenge(res: Response, status: number, message: string): void {
  if (status === 401) {
    res.setHeader("WWW-Authenticate", 'Basic realm="SynthGen", charset="UTF-8"');
  }
  res.status(status).json({ error: message });
}

/**
 * Call this once during startup, before listen(). Refuses to boot a production
 * deployment that has no way to authenticate anyone.
 */
export function assertAuthConfigured(): void {
  if (credentialsConfigured()) return;

  if (isProduction() && !anonymousAllowed()) {
    throw new Error(
      "Refusing to start: BASIC_AUTH_USER and BASIC_AUTH_PASS are not set while " +
        "NODE_ENV=production. Set both, or set ALLOW_ANONYMOUS=true if this " +
        "deployment is genuinely meant to be open.",
    );
  }

  console.warn(
    anonymousAllowed()
      ? "[auth] ALLOW_ANONYMOUS=true — every route is public. Do not expose this " +
          "deployment to the internet."
      : "[auth] No credentials configured (development mode). Set BASIC_AUTH_USER " +
          "and BASIC_AUTH_PASS before deploying.",
  );
}

export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  // health probes must never need a secret
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }

  if (!credentialsConfigured()) {
    if (anonymousAllowed() || !isProduction()) {
      next();
      return;
    }
    // fail closed rather than open
    challenge(
      res,
      503,
      "Server authentication is not configured. Refusing to serve requests.",
    );
    return;
  }

  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) {
    challenge(res, 401, "Authentication required.");
    return;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    challenge(res, 401, "Invalid credentials.");
    return;
  }

  const sep = decoded.indexOf(":");
  if (sep < 0) {
    challenge(res, 401, "Invalid credentials.");
    return;
  }

  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  // evaluate both comparisons so a wrong username and a wrong password cost the same
  const userOk = safeEqual(user, BASIC_AUTH_USER as string);
  const passOk = safeEqual(pass, BASIC_AUTH_PASS as string);

  if (userOk && passOk) {
    next();
    return;
  }

  challenge(res, 401, "Invalid credentials.");
}
