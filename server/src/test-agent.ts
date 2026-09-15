import assert from 'node:assert/strict';
import { parseSchemaFile, parseMetadataMarkdown } from './services/schemaParser.js';
import { buildModelFromSchemas, extendModelFromBase } from './services/ruleBasedAgent.js';
import { validateAndNormalize } from './services/modelValidator.js';
import { assertAdditiveUpdate } from './services/updateGuard.js';

const metadata = `## Table: employees
| column_name | data_type | is_pk | fk_ref |
| --- | --- | --- | --- |
| employee_id | string | Y | - |
## Table: employee_skills
| column_name | data_type | is_pk | fk_ref |
| --- | --- | --- | --- |
| employee_skill_id | string | Y | - |
| employee_id | string | N | employees.employee_id |`;
const parsed = parseMetadataMarkdown(metadata, 'sample.md')!;
const markdownModel = buildModelFromSchemas(parsed);
assert.equal(markdownModel.tables.employee_skills[1].fk_ref, 'employees.employee_id');
assert.notEqual(markdownModel.tables.employees[0].params, markdownModel.tables.employee_skills[0].params);
assert.equal(parseMetadataMarkdown('ordinary narrative', 'sample.md'), null);
assert.throws(() => parseMetadataMarkdown(metadata + '\n' + metadata, 'sample.md'), /Duplicate table/);
assert.throws(() => parseMetadataMarkdown(metadata.replace('| string | Y |', '| unknown | Y |'), 'sample.md'), /invalid metadata row/);

const base = buildModelFromSchemas(parseSchemaFile('departments.sql', 'CREATE TABLE departments (department_id INTEGER PRIMARY KEY, name VARCHAR(100));'));
const before = structuredClone(base);
validateAndNormalize(base);
assert.deepEqual(base, before, 'normalization must not mutate its input');
assert.throws(() => parseSchemaFile('invalid.sql', 'not a schema'), /no supported CREATE TABLE/);
const next = extendModelFromBase(base, parseSchemaFile('locations.sql', 'CREATE TABLE locations (location_id INTEGER PRIMARY KEY, name VARCHAR(100));'));
assert.doesNotThrow(() => assertAdditiveUpdate(base, next));
const changed = structuredClone(next);
changed.tables.departments[0].params = 'pattern=DIFFERENT-######';
assert.throws(() => assertAdditiveUpdate(base, changed), /changed existing table/);
assert.throws(() => assertAdditiveUpdate(base, base), /at least one/);
const invalid = structuredClone(next);
invalid.tables.locations[1].fk_ref = 'missing.id';
invalid.tables.locations[1].fk_mode = 'REFERENCE';
assert.equal(validateAndNormalize(invalid).validation.ok, false);
const badFraction = structuredClone(base);
badFraction.tables.departments[1].nullable_pct = 90;
assert.equal(validateAndNormalize(badFraction).validation.ok, false);
const unsupported = structuredClone(base);
unsupported.tables.departments[1].generator = 'timeseries';
assert.equal(validateAndNormalize(unsupported).validation.ok, false);
console.log('Agent regression tests PASS: additive updates, immutable normalization, unsupported inputs, unresolved FKs and invalid fractions.');