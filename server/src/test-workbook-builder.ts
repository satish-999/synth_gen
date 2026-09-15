/**
 * Regression test for the missing XLSX.set_fs(fs) binding (xlsx 0.20.x under
 * ESM): every prior test either stubbed the writer out entirely
 * (smoke-register-workbook.ts uses copyFileSync on a pre-existing workbook
 * and never calls writeWorkbook/preserveBaseWorkbook) or happened to run
 * against a dev environment whose locally-installed xlsx version predated
 * the dependency bump that introduced the requirement. Neither shape of gap
 * would have caught this: it needs an actual write to a real filesystem
 * path, through the real function, with whatever xlsx version is actually
 * installed.
 */
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseSchemaFile } from './services/schemaParser.js';
import { buildModelFromSchemas } from './services/ruleBasedAgent.js';
import { validateAndNormalize } from './services/modelValidator.js';
import { writeWorkbook, readWorkbook, preserveBaseWorkbook } from './services/workbookBuilder.js';

const outDir = path.join('uploads', 'drafts', '_test-workbook-builder');
rmSync(outDir, { recursive: true, force: true });

// writeWorkbook: build from a schema file, write, confirm the file actually
// landed on disk, then reopen it and confirm the structure round-trips.
const schema = parseSchemaFile('widgets.sql',
  'CREATE TABLE widgets (widget_id INTEGER PRIMARY KEY, name VARCHAR(80), weight_kg DECIMAL(6,2));');
const { spec: built } = validateAndNormalize(buildModelFromSchemas(schema));

const basePath = path.join(outDir, 'base.xlsx');
writeWorkbook(built, basePath);
assert.ok(existsSync(basePath), 'writeWorkbook must produce a file on disk');

const reopened = readWorkbook(basePath);
assert.deepEqual(
  reopened.tables.widgets.map(c => c.name).sort(),
  built.tables.widgets.map(c => c.name).sort(),
  'round-tripped column names must match what was written',
);
const originalPk = built.tables.widgets.find(c => c.pk)?.name;
const reopenedPk = reopened.tables.widgets.find(c => c.pk)?.name;
assert.equal(reopenedPk, originalPk, 'PK flag must survive the round trip');
assert.deepEqual(reopened.rules, built.rules, 'rules must survive the round trip');

// preserveBaseWorkbook: the other function the same bug broke. Build a
// second, "updated" spec with a new table, write it as a draft, then merge
// the base's original sheets back in and confirm the merged file is valid
// and still contains both the preserved base table and the new one.
const withNewTable = structuredClone(built);
withNewTable.tables.suppliers = [
  { name: 'supplier_id', dtype: 'string', pk: true, fk_ref: null, fk_mode: null,
    cardinality: null, orphan_pct: 0, generator: 'pattern', params: 'pattern=SUP-#####',
    nullable_pct: 0, unique: true },
];

const draftPath = path.join(outDir, 'draft.xlsx');
writeWorkbook(withNewTable, draftPath);
preserveBaseWorkbook(basePath, draftPath);
assert.ok(existsSync(draftPath), 'preserveBaseWorkbook must leave a valid file at draftPath');

const merged = readWorkbook(draftPath);
assert.ok(merged.tables.widgets, 'preserved base table must still be present');
assert.ok(merged.tables.suppliers, 'newly added table must be present');
assert.deepEqual(
  merged.tables.widgets.map(c => c.name).sort(),
  built.tables.widgets.map(c => c.name).sort(),
  'preserveBaseWorkbook must not alter the base table it preserves',
);

rmSync(outDir, { recursive: true, force: true });
console.log('Workbook builder round-trip PASS: writeWorkbook writes a real file and reopens correctly; preserveBaseWorkbook merges without corrupting the base.');
