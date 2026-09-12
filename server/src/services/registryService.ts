import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ENGINE_DIR, REGISTRY_PATH } from "../config.js";
import { getModelObjects } from "./modelService.js";

export interface RegistryFamily {
  id: string;
  display_name: string;
  latest_version: number;
  versions: number[];
  created_at: string;
}

export interface RegistryIndex {
  families: RegistryFamily[];
}

export interface FamilyMeta {
  id: string;
  display_name: string;
  description?: string;
  tags?: string[];
}

export interface VersionManifest {
  version: number;
  tables: Record<string, { pk: string[]; sizing: boolean; parents: string[] }>;
  views: string[];
  table_count: number;
  view_count: number;
}

export interface VersionRegistration {
  registered_at: string;
  registered_by: string;
  mode: "CREATE" | "UPDATE" | "REWRITE" | "BOOTSTRAP" | "IMPORT";
  source?: string;
  agent_job_id?: string;
}

export interface ModelRef {
  family: string;
  version: number;
  modelPath: string;
  modelKey: string; // "retail@v1" — stored in run history
}

const INDEX_PATH = path.join(REGISTRY_PATH, "index.json");

function readIndex(): RegistryIndex {
  if (!existsSync(INDEX_PATH)) return { families: [] };
  return JSON.parse(readFileSync(INDEX_PATH, "utf8")) as RegistryIndex;
}

function writeIndex(index: RegistryIndex): void {
  mkdirSync(REGISTRY_PATH, { recursive: true });
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf8");
}

export function modelKey(family: string, version: number): string {
  return `${family}@v${version}`;
}

export function versionDir(family: string, version: number): string {
  return path.join(REGISTRY_PATH, family, `v${version}`);
}

export function workbookPath(family: string, version: number): string {
  return path.join(versionDir(family, version), "data_model.xlsx");
}

/** Parse "retail@v1", "retail/1", or legacy "retail_demo" (maps to retail v1). */
export function parseModelRef(input: string): { family: string; version: number } | null {
  const atMatch = /^([a-zA-Z0-9_-]+)@v(\d+)$/.exec(input);
  if (atMatch) return { family: atMatch[1], version: Number(atMatch[2]) };

  const slashMatch = /^([a-zA-Z0-9_-]+)\/(\d+)$/.exec(input);
  if (slashMatch) return { family: slashMatch[1], version: Number(slashMatch[2]) };

  // Legacy Phase 2 alias
  if (input === "retail_demo") return { family: "retail", version: 1 };

  return null;
}

export function resolveModelRef(
  family: string,
  version: number,
): ModelRef | null {
  const wb = workbookPath(family, version);
  if (!existsSync(wb)) return null;
  return { family, version, modelPath: wb, modelKey: modelKey(family, version) };
}

export function resolveModelInput(input: string): ModelRef | null {
  const parsed = parseModelRef(input);
  if (!parsed) return null;
  return resolveModelRef(parsed.family, parsed.version);
}

export function listFamilies(): RegistryFamily[] {
  return readIndex().families;
}

export function getFamily(familyId: string): RegistryFamily | undefined {
  return readIndex().families.find((f) => f.id === familyId);
}

export async function getVersionManifest(
  family: string,
  version: number,
): Promise<VersionManifest | null> {
  const manifestPath = path.join(versionDir(family, version), "manifest.json");
  if (existsSync(manifestPath)) {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as VersionManifest;
  }
  const ref = resolveModelRef(family, version);
  if (!ref) return null;
  const objects = await getModelObjects(ref.modelPath);
  return {
    version,
    tables: objects.tables,
    views: objects.views,
    table_count: Object.keys(objects.tables).length,
    view_count: objects.views.length,
  };
}

export function getRegistration(
  family: string,
  version: number,
): VersionRegistration | null {
  const p = path.join(versionDir(family, version), "registration.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as VersionRegistration;
}

export function getFamilyMeta(familyId: string): FamilyMeta | null {
  const p = path.join(REGISTRY_PATH, familyId, "meta.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as FamilyMeta;
}

/**
 * Register a new immutable version. Used by bootstrap now; agent approve in Phase 6.
 */
export async function registerVersion(opts: {
  family: string;
  displayName: string;
  description?: string;
  workbookSource: string;
  mode: VersionRegistration["mode"];
  registeredBy: string;
  version?: number;
  agentJobId?: string;
  sourceSchemasDir?: string;
  diffSourcePath?: string;
  baseVersion?: number;
  confirmedFks?: string[];
}): Promise<ModelRef> {
  mkdirSync(REGISTRY_PATH, { recursive: true });

  const index = readIndex();
  let familyEntry = index.families.find((f) => f.id === opts.family);
  const isNewFamily = !familyEntry;

  const version =
    opts.version ??
    (familyEntry ? Math.max(...familyEntry.versions) + 1 : 1);

  const vDir = versionDir(opts.family, version);
  mkdirSync(path.join(vDir, "source_schemas"), { recursive: true });

  const destWb = path.join(vDir, "data_model.xlsx");
  copyFileSync(opts.workbookSource, destWb);

  const objects = await getModelObjects(destWb);
  const manifest: VersionManifest = {
    version,
    tables: objects.tables,
    views: objects.views,
    table_count: Object.keys(objects.tables).length,
    view_count: objects.views.length,
  };
  writeFileSync(path.join(vDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const registration: VersionRegistration = {
    registered_at: new Date().toISOString(),
    registered_by: opts.registeredBy,
    mode: opts.mode,
    source: opts.workbookSource,
    agent_job_id: opts.agentJobId,
  };
  writeFileSync(
    path.join(vDir, "registration.json"),
    JSON.stringify(registration, null, 2),
  );

  if (opts.diffSourcePath && existsSync(opts.diffSourcePath)) {
    const diffName = opts.baseVersion
      ? `diff_from_v${opts.baseVersion}.json`
      : "diff.json";
    copyFileSync(opts.diffSourcePath, path.join(vDir, diffName));
  }

  if (opts.sourceSchemasDir && existsSync(opts.sourceSchemasDir)) {
    const destSchemas = path.join(vDir, "source_schemas");
    mkdirSync(destSchemas, { recursive: true });
    for (const f of readdirSync(opts.sourceSchemasDir)) {
      copyFileSync(path.join(opts.sourceSchemasDir, f), path.join(destSchemas, f));
    }
  }

  if (opts.confirmedFks?.length) {
    writeFileSync(
      path.join(vDir, "confirmed_fks.json"),
      JSON.stringify(opts.confirmedFks, null, 2),
    );
  }

  if (isNewFamily) {
    mkdirSync(path.join(REGISTRY_PATH, opts.family), { recursive: true });
    const meta: FamilyMeta = {
      id: opts.family,
      display_name: opts.displayName,
      description: opts.description,
      tags: ["demo"],
    };
    writeFileSync(
      path.join(REGISTRY_PATH, opts.family, "meta.json"),
      JSON.stringify(meta, null, 2),
    );
    familyEntry = {
      id: opts.family,
      display_name: opts.displayName,
      latest_version: version,
      versions: [version],
      created_at: new Date().toISOString(),
    };
    index.families.push(familyEntry);
  } else {
    if (!familyEntry!.versions.includes(version)) {
      familyEntry!.versions.push(version);
      familyEntry!.versions.sort((a, b) => a - b);
    }
    if (version > familyEntry!.latest_version) {
      familyEntry!.latest_version = version;
    }
  }

  writeIndex(index);
  return resolveModelRef(opts.family, version)!;
}

/** Seed retail/v1 from the engine demo workbook if registry is empty. */
export async function bootstrapRegistryIfEmpty(): Promise<void> {
  const index = readIndex();
  if (index.families.length > 0) return;

  const demoWb = path.join(ENGINE_DIR, "data_model_demo.xlsx");
  if (!existsSync(demoWb)) {
    console.warn(
      `[registry] No families and no demo workbook at ${demoWb} — run engine/verify.py first.`,
    );
    return;
  }

  const ref = await registerVersion({
    family: "retail",
    displayName: "Retail Demo",
    description: "Bootstrap demo model — category, customer, product, sales_order, order_item",
    workbookSource: demoWb,
    mode: "BOOTSTRAP",
    registeredBy: "system",
    version: 1,
  });
  console.log(`[registry] Bootstrapped ${ref.modelKey} from demo workbook`);
}
