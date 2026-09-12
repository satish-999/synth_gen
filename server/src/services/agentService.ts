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
import { writeWorkbook, writeManifest, writeDiffCompare } from "./workbookBuilder.js";
import path from "node:path";

async function callClaude(
  mode: "CREATE" | "UPDATE" | "REWRITE",
  schemas: ParsedSchema[],
  opts?: { domainHint?: string; baseSpec?: AgentModelSpec; familyId?: string; baseVersion?: number },
): Promise<AgentModelSpec> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
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
      spec.warnings.push(`Validation issues after retry: ${validation.errors.join("; ")}`);
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
): Promise<AgentModelSpec> {
  if (ANTHROPIC_API_KEY) {
    try {
      return await callClaude("CREATE", schemas, { domainHint });
    } catch (e) {
      console.warn("[agent] Claude failed, falling back to rule-based:", (e as Error).message);
    }
  }
  return buildModelFromSchemas(schemas);
}

export async function generateUpdateModel(
  baseSpec: AgentModelSpec,
  newSchemas: ParsedSchema[],
  familyId: string,
  baseVersion: number,
): Promise<AgentModelSpec> {
  if (ANTHROPIC_API_KEY) {
    try {
      return await callClaude("UPDATE", newSchemas, { baseSpec, familyId, baseVersion });
    } catch (e) {
      console.warn("[agent] Claude UPDATE failed, falling back:", (e as Error).message);
    }
  }
  return extendModelFromBase(baseSpec, newSchemas);
}

export async function generateRewriteModel(
  schemas: ParsedSchema[],
  baseSpec: AgentModelSpec,
  familyId: string,
  baseVersion: number,
  domainHint?: string,
): Promise<AgentModelSpec> {
  if (ANTHROPIC_API_KEY) {
    try {
      return await callClaude("REWRITE", schemas, { baseSpec, familyId, baseVersion, domainHint });
    } catch (e) {
      console.warn("[agent] Claude REWRITE failed, falling back:", (e as Error).message);
    }
  }
  const spec = buildModelFromSchemas(schemas);
  spec.warnings.push(`REWRITE of ${familyId} v${baseVersion} — full rebuild from ${schemas.length} schema(s).`);
  return finalizeRuleBased(spec);
}

export async function buildDraftWorkbook(
  spec: AgentModelSpec,
  draftDir: string,
  opts?: { mode?: string; baseSpec?: AgentModelSpec | null },
): Promise<{ workbookPath: string; manifestPath: string; diffPath: string }> {
  const mode = opts?.mode ?? "CREATE";
  const workbookPath = path.join(draftDir, "data_model.xlsx");
  const manifestPath = path.join(draftDir, "manifest.json");
  const diffPath = path.join(draftDir, "diff.json");

  const { spec: normalized } = validateAndNormalize(spec);
  writeWorkbook(normalized, workbookPath);
  writeManifest(normalized, manifestPath);
  writeDiffCompare(opts?.baseSpec ?? null, normalized, diffPath, mode);

  const val = await runPython(VALIDATE_MODEL, [workbookPath]);
  if (val.code !== 0) {
    throw new Error(`Draft model validation failed:\n${val.stderr || val.stdout}`);
  }

  return { workbookPath, manifestPath, diffPath };
}
