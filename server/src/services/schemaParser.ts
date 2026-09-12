import * as XLSX from "xlsx";

export type SchemaFormat = "csv" | "ddl" | "json" | "text" | "xlsx";

export interface ParsedColumn {
  name: string;
  dtype: "string" | "int" | "float" | "date" | "bool";
  nullable?: boolean;
  pk?: boolean;
}

export interface ParsedSchema {
  tableName: string;
  columns: ParsedColumn[];
  sourceFile: string;
  format: SchemaFormat;
}

function inferDtype(values: string[]): ParsedColumn["dtype"] {
  const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
  if (nonEmpty.length === 0) return "string";
  if (nonEmpty.every((v) => /^(true|false|0|1)$/i.test(String(v)))) return "bool";
  if (nonEmpty.every((v) => /^-?\d+$/.test(String(v)))) return "int";
  if (nonEmpty.every((v) => /^-?\d+(\.\d+)?$/.test(String(v)))) return "float";
  const DATE_RE =
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$|^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/;
  if (nonEmpty.every((v) => DATE_RE.test(String(v).trim()) && !Number.isNaN(Date.parse(String(v)))))
    return "date";
  return "string";
}

function slugTableName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function sqlTypeToDtype(sqlType: string): ParsedColumn["dtype"] {
  const t = sqlType.toLowerCase();
  if (/int|serial|bigint|smallint/.test(t)) return "int";
  if (/float|double|decimal|numeric|real/.test(t)) return "float";
  if (/date|time|timestamp/.test(t)) return "date";
  if (/bool/.test(t)) return "bool";
  return "string";
}

export function parseCsv(content: string, filename: string): ParsedSchema {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1, Math.min(lines.length, 51)).map((l) =>
    l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")),
  );
  const columns: ParsedColumn[] = headers.map((name, i) => ({
    name,
    dtype: inferDtype(rows.map((r) => r[i] ?? "")),
  }));
  return {
    tableName: slugTableName(filename),
    columns,
    sourceFile: filename,
    format: "csv",
  };
}

export function parseDdl(content: string, filename: string): ParsedSchema[] {
  const results: ParsedSchema[] = [];
  const re =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s*\(([\s\S]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const tableName = m[1].toLowerCase();
    const body = m[2];
    const columns: ParsedColumn[] = [];
    for (const part of body.split(",")) {
      const col = part.trim();
      if (!col || /^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|KEY|CHECK)\s/i.test(col)) continue;
      const cm = /^[`"']?(\w+)[`"']?\s+(\w+(?:\(\d+(?:,\d+)?\))?)/i.exec(col);
      if (cm) {
        columns.push({
          name: cm[1].toLowerCase(),
          dtype: sqlTypeToDtype(cm[2]),
          nullable: /PRIMARY\s+KEY/i.test(col) ? false : !/NOT\s+NULL/i.test(col),
          pk: /PRIMARY\s+KEY/i.test(col),
        });
      }
    }
    if (columns.length) {
      results.push({ tableName, columns, sourceFile: filename, format: "ddl" });
    }
  }
  if (results.length === 0) {
    results.push({
      tableName: slugTableName(filename),
      columns: [{ name: "id", dtype: "string" }],
      sourceFile: filename,
      format: "text",
    });
  }
  return results;
}

export function parseJson(content: string, filename: string): ParsedSchema {
  const data = JSON.parse(content) as Record<string, unknown>;
  if (data.table && Array.isArray(data.columns)) {
    return {
      tableName: String(data.table).toLowerCase(),
      columns: (data.columns as ParsedColumn[]).map((c) => ({
        name: String(c.name),
        dtype: (c.dtype as ParsedColumn["dtype"]) ?? "string",
      })),
      sourceFile: filename,
      format: "json",
    };
  }
  if (Array.isArray(data)) {
    const keys = Object.keys((data[0] as object) ?? {});
    return {
      tableName: slugTableName(filename),
      columns: keys.map((k) => ({
        name: k,
        dtype: inferDtype(data.slice(0, 50).map((r) => String((r as Record<string, unknown>)[k] ?? ""))),
      })),
      sourceFile: filename,
      format: "json",
    };
  }
  throw new Error("JSON schema must be { table, columns[] } or an array of objects");
}

export function parseXlsx(buffer: Buffer, filename: string): ParsedSchema[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return wb.SheetNames.filter((n) => !n.startsWith("_")).map((sheetName) => {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const keys =
      rows.length > 0
        ? Object.keys(rows[0])
        : (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] as string[] | undefined) ?? [];
    return {
      tableName: sheetName.toLowerCase().replace(/\s+/g, "_"),
      columns: keys.map((k) => ({
        name: String(k),
        dtype: inferDtype(rows.slice(0, 50).map((r) => String(r[k] ?? ""))),
      })),
      sourceFile: `${filename}#${sheetName}`,
      format: "xlsx" as SchemaFormat,
    };
  });
}

export function detectFormat(filename: string): SchemaFormat {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv") return "csv";
  if (ext === "sql" || ext === "ddl") return "ddl";
  if (ext === "json") return "json";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  return "text";
}

export function parseSchemaFile(
  filename: string,
  content: Buffer | string,
): ParsedSchema[] {
  const format = detectFormat(filename);
  const text = typeof content === "string" ? content : content.toString("utf8");

  switch (format) {
    case "csv":
      return [parseCsv(text, filename)];
    case "ddl":
      return parseDdl(text, filename);
    case "json":
      return [parseJson(text, filename)];
    case "xlsx":
      return parseXlsx(typeof content === "string" ? Buffer.from(content) : content, filename);
    default:
      return parseDdl(text, filename).length > 0
        ? parseDdl(text, filename)
        : [
            {
              tableName: slugTableName(filename),
              columns: text
                .split(/\r?\n/)
                .filter(Boolean)
                .map((line) => ({ name: line.split(/[,\t|]/)[0].trim(), dtype: "string" as const })),
              sourceFile: filename,
              format: "text",
            },
          ];
  }
}
