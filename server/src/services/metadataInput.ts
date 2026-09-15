import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ENGINE_DIR, ANTHROPIC_API_KEY } from '../config.js';
import { runPython } from '../utils/python.js';
import { parseSchemaFile, parseMetadataMarkdown, type ParsedSchema } from './schemaParser.js';

export const allowedMetadataExtensions = new Set(['.csv', '.sql', '.ddl', '.json', '.xlsx', '.xls', '.pdf', '.docx', '.txt', '.md']);
export async function readMetadataFiles(files: { originalname: string; path: string }[]): Promise<ParsedSchema[]> {
  const result: ParsedSchema[] = [];
  let characters = 0;
  for (const file of files) {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedMetadataExtensions.has(extension)) throw new Error(`Unsupported metadata file: ${file.originalname}`);
    if (['.md', '.txt'].includes(extension)) {
      const text = readFileSync(file.path, 'utf8');
      if (text.length > 100_000) throw new Error('Document exceeds 100,000 characters.');
      const explicit = parseMetadataMarkdown(text, file.originalname);
      if (explicit) {
        characters += text.length;
        if (characters > 150_000) throw new Error('Combined metadata exceeds 150,000 characters.');
        result.push(...explicit);
        continue;
      }
    }
    if (['.pdf', '.docx', '.txt', '.md'].includes(extension)) {
      if (!ANTHROPIC_API_KEY) throw new Error('Document understanding requires a Claude API key configured on the server. Structured SQL, JSON, CSV and Excel schemas work without a key.');
      const extracted = await runPython(path.join(ENGINE_DIR, 'extract_metadata.py'), [file.path, extension]);
      if (extracted.code !== 0) throw new Error(`${file.originalname}: ${extracted.stderr || 'Document extraction failed'}`);
      const { text } = JSON.parse(extracted.stdout) as { text: string };
      characters += text.length;
      result.push({ tableName: '', columns: [], sourceFile: file.originalname, format: 'text', sourceText: text });
    } else {
      const schemas = parseSchemaFile(file.originalname, readFileSync(file.path));
      characters += JSON.stringify(schemas).length;
      result.push(...schemas);
    }
    if (characters > 150_000) throw new Error('Combined metadata exceeds 150,000 characters. Split this into smaller model updates.');
  }
  if (!result.length) throw new Error('No metadata found in uploaded files.');
  return result;
}