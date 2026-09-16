import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL, VALIDATE_MODEL } from "../config.js";
import { runPython } from "../utils/python.js";
import type { ParsedSchema } from "./schemaParser.js";
import { AGENT_SYSTEM_PROMPT, buildUserPrompt } from "./agentPrompt.js";
import { validateAndNormalize } from "./modelValidator.js";
import {
  buildModelFromSchemas,
  extendModelFromBase,
  type AgentModelSpec,
} from "./ruleBasedAgent.js";
import { writeWorkbook, writeManifest, writeDiffCompare, preserveBaseWorkbook } from "./workbookBuilder.js";
import path from "node:path";
import { assertAdditiveUpdate } from './updateGuard.js';

/** Strip a literal secret out of a message before it can reach a thrown
 * Error, a persisted job record, or a log line. Defense in depth: the
 * Anthropic SDK's own error messages don't echo the key back, but nothing
 * downstream should have to rely on that staying true. */
export function redact(message: string, secret: string | undefined): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}

async function callClaude(
  mode: "CREATE" | "UPDATE" | "REWRITE",
  schemas: ParsedSchema[],
  opts?: { domainHint?: string; baseSpec?: AgentModelSpec; familyId?: string; baseVersion?: number; apiKey?: string },
): Promise<AgentModelSpec> {
  // Per-request client: a caller-supplied key is used for this call only and
  // is never stored anywhere (module scope, the job record, a cache) — it
  // lives only in this function's closure for the duration of this request.
  const effectiveKey = opts?.apiKey || ANTHROPIC_API_KEY;
  const client = new Anthropic({ apiKey: effectiveKey, timeout: 120_000, maxRetries: 1 });
  const userPrompt = buildUserPrompt(schemas, {
    mode: mode === "UPDATE" ? "UPDATE" : undefined,
    baseSpec: opts?.baseSpec,
    domainHint: opts?.domainHint,
  });

  let extra = "";
  if (mode === "REWRITE") {
    extra = `\nMODE: REWRITE — rebuild full model for family ${opts?.familyId} replacing v${opts?.baseVersion}.`;
  }

  async function request(retryErrors?: string[]): Promise<AgentModelSpec> {
    const retryBlock = retryErrors?.length
      ? `\n\nVALIDATION ERRORS — fix ALL of these:\n${retryErrors.map((e) => `- ${e}`).join("\n")}`
      : "";

    const msg = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 8192,
      system: AGENT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt + extra + retryBlock }],
    });

    if (msg.stop_reason === 'max_tokens') throw new Error('The model response exceeded its output limit. Upload fewer tables per update.');

    const text = msg.content[0].type === "text" ? msg.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Agent did not return valid JSON");

    const parsed = JSON.parse(jsonMatch[0]) as AgentModelSpec;
    parsed.warnings = parsed.warnings ?? [];
    parsed.inferred_fks = parsed.inferred_fks ?? [];
    parsed.rules = parsed.rules ?? [];

    const { spec, validation } = validateAndNormalize(parsed);
    if (!validation.ok) {
      if (!retryErrors) {
        return request(validation.errors);
      }
      throw new Error(`Model remains invalid after retry: ${validation.errors.join('; ')}`);
    }
    spec.warnings.unshift(`Built with Claude API (${mode}) — review before registering.`);
    return spec;
  }

  return request();
}

function finalizeRuleBased(spec: AgentModelSpec): AgentModelSpec {
  const { spec: normalized } = validateAndNormalize(spec);
  return normalized;
}

export async function generateCreateModel(
  schemas: ParsedSchema[],
  domainHint?: string,
  apiKey?: string,
): Promise<AgentModelSpec> {
  if (ANTHROPIC_API_KEY || apiKey) {
    try {
      return await callClaude("CREATE", schemas, { domainHint, apiKey });
    } catch (e) {
      throw new Error(`Claude model creation failed: ${redact((e as Error).message, apiKey)}`);
    }
  }
  return buildModelFromSchemas(schemas);
}

export async function generateUpdateModel(
  baseSpec: AgentModelSpec,
  newSchemas: ParsedSchema[],
  familyId: string,
  baseVersion: number,
  domainHint?: string,
  apiKey?: string,
): Promise<AgentModelSpec> {
  if (ANTHROPIC_API_KEY || apiKey) {
    try {
      const next = await callClaude("UPDATE", newSchemas, { baseSpec, familyId, baseVersion, domainHint, apiKey });
      assertAdditiveUpdate(baseSpec, next);
      return next;
    } catch (e) {
      throw new Error(`Claude model update failed: ${redact((e as Error).message, apiKey)}`);
    }
  }
  const next = extendModelFromBase(baseSpec, newSchemas);
  assertAdditiveUpdate(baseSpec, next);
  return next;
}

export async function generateRewriteModel(
  schemas: ParsedSchema[],
  baseSpec: AgentModelSpec,
  familyId: string,
  baseVersion: number,
  domainHint?: string,
  apiKey?: string,
): Promise<AgentModelSpec> {
  if (ANTHROPIC_API_KEY || apiKey) {
    try {
      return await callClaude("REWRITE", schemas, { baseSpec, familyId, baseVersion, domainHint, apiKey });
    } catch (e) {
      throw new Error(`Claude model rewrite failed: ${redact((e as Error).message, apiKey)}`);
    }
  }
  const spec = buildModelFromSchemas(schemas);
  spec.warnings.push(`REWRITE of ${familyId} v${baseVersion} — full rebuild from ${schemas.length} schema(s).`);
  return finalizeRuleBased(spec);
}

export async function buildDraftWorkbook(
  spec: AgentModelSpec,
  draftDir: string,
  opts?: { mode?: string; baseSpec?: AgentModelSpec | null; baseWorkbookPath?: string },
): Promise<{ workbookPath: string; manifestPath: string; diffPath: string }> {
  const mode = opts?.mode ?? "CREATE";
  const workbookPath = path.join(draftDir, "data_model.xlsx");
  const manifestPath = path.join(draftDir, "manifest.json");
  const diffPath = path.join(draftDir, "diff.json");

  const { spec: normalized, validation } = validateAndNormalize(spec);
  if (!validation.ok) throw new Error(validation.errors.join('\n'));
  if (mode === 'UPDATE' && opts?.baseSpec) assertAdditiveUpdate(opts.baseSpec, normalized);
  writeWorkbook(normalized, workbookPath);
  if (mode === 'UPDATE' && opts?.baseWorkbookPath) preserveBaseWorkbook(opts.baseWorkbookPath, workbookPath);
  writeManifest(normalized, manifestPath);
  writeDiffCompare(opts?.baseSpec ?? null, normalized, diffPath, mode);

  const val = await runPython(VALIDATE_MODEL, [workbookPath]);
  if (val.code !== 0) {
    throw new Error(`Draft model validation failed:\n${val.stderr || val.stdout}`);
  }

  return { workbookPath, manifestPath, diffPath };
}