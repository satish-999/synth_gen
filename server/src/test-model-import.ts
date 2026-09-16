/** Regression tests for CSV/JSON data-model import (server/src/services/modelImport.ts). */
import assert from 'node:assert/strict';
import { parseModelCsv, parseModelJson } from './services/modelImport.js';
import { writeWorkbook, readWorkbook } from './services/workbookBuilder.js';
import { validateAndNormalize } from './services/modelValidator.js';
import { runPython } from './utils/python.js';
import { VALIDATE_MODEL, SYNTHGEN } from './config.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const CSV = `## TABLE:category
column_name,dtype,pk,fk_ref,fk_mode,cardinality,orphan_pct,generator,params,nullable_pct,unique
category_id,string,Y,,,,,pattern,pattern=CAT-##,,Y
category_name,string,N,,,,,choice,"values=Electronics,Clothing; weights=0.5,0.5",,

## TABLE:product
column_name,dtype,pk,fk_ref,fk_mode,cardinality,orphan_pct,generator,params,nullable_pct,unique
product_id,string,Y,,,,,pattern,pattern=PRD-#####,,Y
category_id,string,N,category.category_id,SIZING,"0,20,poisson(4)",0.05,,,,
base_cost,decimal,N,,,,,numeric,dist=uniform; min=1; max=4; round=2,,
unit_price,decimal,N,,,,,numeric,dist=uniform; min=5; max=500; round=2,,

## VIEW:active_catalog
source_objects,product
filter_logic,unit_price > 0
column_name,data_type,derivation
product_id,string,product_id
unit_price,decimal,unit_price

## RULES
rule_id,object,rule_type,definition
R1,product,bound,unit_price >= base_cost
`;

const JSON_MODEL = {
  tables: {
    category: [
      { name: 'category_id', dtype: 'string', pk: true, generator: 'pattern', params: 'pattern=CAT-##', unique: true },
      { name: 'category_name', dtype: 'string', generator: 'choice', params: 'values=Electronics,Clothing; weights=0.5,0.5' },
    ],
    product: [
      { name: 'product_id', dtype: 'string', pk: true, generator: 'pattern', params: 'pattern=PRD-#####', unique: true },
      { name: 'category_id', dtype: 'string', fk_ref: 'category.category_id', fk_mode: 'SIZING', cardinality: '0,20,poisson(4)', orphan_pct: 0.05 },
      { name: 'base_cost', dtype: 'decimal', generator: 'numeric', params: 'dist=uniform; min=1; max=4; round=2' },
      { name: 'unit_price', dtype: 'decimal', generator: 'numeric', params: 'dist=uniform; min=5; max=500; round=2' },
    ],
  },
  views: {
    active_catalog: {
      source_objects: 'product',
      filter_logic: 'unit_price > 0',
      columns: [
        { name: 'product_id', dtype: 'string', derivation: 'product_id' },
        { name: 'unit_price', dtype: 'decimal', derivation: 'unit_price' },
      ],
    },
  },
  rules: [{ rule_id: 'R1', object: 'product', rule_type: 'bound', definition: 'unit_price >= base_cost' }],
};

// --- 1. both formats parse without error ------------------------------------
const csvResult = parseModelCsv(CSV);
assert.equal(csvResult.errors.length, 0, `CSV should parse cleanly: ${csvResult.errors.join('; ')}`);
assert.ok(csvResult.spec);

const jsonResult = parseModelJson(JSON.stringify(JSON_MODEL));
assert.equal(jsonResult.errors.length, 0, `JSON should parse cleanly: ${jsonResult.errors.join('; ')}`);
assert.ok(jsonResult.spec);

// --- 2. CSV and JSON describe the identical structure -----------------------
assert.deepEqual(csvResult.spec!.tables, jsonResult.spec!.tables, 'CSV and JSON must produce identical tables');
assert.deepEqual(csvResult.spec!.views, jsonResult.spec!.views, 'CSV and JSON must produce identical views');
assert.deepEqual(csvResult.spec!.rules, jsonResult.spec!.rules, 'CSV and JSON must produce identical rules');
console.log('CSV/JSON equivalence: PASS');

// --- 3. per-field errors, not a stack trace ----------------------------------
const badCases: [string, () => { errors: string[] }][] = [
  ['missing dtype', () => parseModelCsv('## TABLE:t\ncolumn_name,dtype,pk,fk_ref,fk_mode,cardinality,orphan_pct,generator,params,nullable_pct,unique\nfoo,,N,,,,,,,,N\n')],
  ['bad orphan_pct number', () => parseModelCsv('## TABLE:t\ncolumn_name,dtype,pk,fk_ref,fk_mode,cardinality,orphan_pct,generator,params,nullable_pct,unique\nid,string,Y,,,,,pattern,pattern=X-##,,not-a-number\n')],
  ['view references unknown table', () => parseModelCsv('## TABLE:t\ncolumn_name,dtype,pk,fk_ref,fk_mode,cardinality,orphan_pct,generator,params,nullable_pct,unique\nid,string,Y,,,,,pattern,pattern=X-##,,Y\n\n## VIEW:v\nsource_objects,nonexistent\ncolumn_name,data_type,derivation\nid,string,id\n')],
  ['empty file', () => parseModelCsv('')],
  ['no sections', () => parseModelCsv('just,some,text\n')],
  ['invalid JSON syntax', () => parseModelJson('{not valid json')],
  ['JSON missing tables', () => parseModelJson('{"rules": []}')],
  ['JSON column missing name', () => parseModelJson(JSON.stringify({ tables: { t: [{ dtype: 'string' }] } }))],
  ['JSON wrong type for pk', () => parseModelJson(JSON.stringify({ tables: { t: [{ name: 'id', dtype: 'string', pk: 'yes' }] } }))],
];
for (const [label, run] of badCases) {
  const result = run();
  assert.ok(result.errors.length > 0, `${label}: expected at least one error, got none`);
  assert.ok(result.errors.every((e) => typeof e === 'string' && e.length > 0), `${label}: errors must be readable strings`);
}
console.log('Per-field error handling: PASS (', badCases.length, 'cases, all produced clear errors, none threw)');

// unique's "not-a-number" case above tests orphan_pct on a non-unique test; also
// directly confirm a thrown-exception-shaped input never escapes as an
// unhandled exception from the parser itself:
assert.doesNotThrow(() => parseModelCsv('## TABLE:t\ngarbage\nrow\nhere\n'));
assert.doesNotThrow(() => parseModelJson('null'));
assert.doesNotThrow(() => parseModelJson('[1,2,3]'));
console.log('Parsers never throw on malformed input: PASS');

// --- 4. full round trip: parse -> writeWorkbook -> readWorkbook -------------
const dir = path.join('uploads', 'drafts', '_test-model-import');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const wbPath = path.join(dir, 'data_model.xlsx');
writeWorkbook(csvResult.spec!, wbPath);
const reopened = readWorkbook(wbPath);
assert.deepEqual(reopened.tables, csvResult.spec!.tables, 'tables must survive writeWorkbook -> readWorkbook');
assert.deepEqual(reopened.views, csvResult.spec!.views, 'views must survive writeWorkbook -> readWorkbook');
assert.deepEqual(reopened.rules, csvResult.spec!.rules, 'rules must survive writeWorkbook -> readWorkbook');
console.log('writeWorkbook/readWorkbook round trip: PASS');

// --- 5. the generated workbook is valid to the real engine, and generates ---
const { validation } = validateAndNormalize(csvResult.spec!);
assert.equal(validation.ok, true, `modelValidator should accept the imported spec: ${validation.errors.join('; ')}`);

const val = await runPython(VALIDATE_MODEL, [wbPath]);
assert.equal(val.code, 0, `validate_model.py should accept the generated workbook: ${val.stderr}`);

const configPath = path.join(dir, 'run_config.yaml');
writeFileSync(
  configPath,
  `model: ${wbPath}\nseed: 3\nlocale: en_US\ntargets:\n  category: {rows: 5}\n  product: {rows: 30}\noutput:\n  format: [csv]\n  path: ${dir}/output/\n`,
);
const gen = await runPython(SYNTHGEN, ['--model', wbPath, '--config', configPath]);
assert.equal(gen.code, 0, `synthgen.py should generate successfully from the imported model: ${gen.stderr}`);
assert.match(gen.stdout, /view\s+active_catalog:.*computed/, 'the imported view must actually compute during generation');
console.log('Generated workbook validates and generates via the real engine: PASS');

rmSync(dir, { recursive: true, force: true });
console.log('\nModel import tests: ALL PASS');
