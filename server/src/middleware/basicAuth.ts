import type { Request, Response, NextFunction } from "express";
import { BASIC_AUTH_PASS, BASIC_AUTH_USER } from "../config.js";

/** Optional HTTP Basic Auth when BASIC_AUTH_USER and BASIC_AUTH_PASS are set. */
export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  if (!BASIC_AUTH_USER || !BASIC_AUTH_PASS) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="SynthGen"');
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  if (user === BASIC_AUTH_USER && pass === BASIC_AUTH_PASS) {
    next();
    return;
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="SynthGen"');
  res.status(401).json({ error: "Invalid credentials." });
}
