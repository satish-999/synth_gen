import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:3080/api';
async function api(url: string, init?: RequestInit) {
  const response = await fetch(base + url, init);
  const value = await response.json() as any;
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
async function draft(family: string, mode: string, sql: string, baseVersion?: number) {
  const form = new FormData();
  form.append('familyId', family); form.append('mode', mode); form.append('displayName', 'Agent integration demo');
  if (baseVersion) form.append('baseVersion', String(baseVersion));
  form.append('schemas', new Blob([sql]), 'schema.sql');
  const start = await api('/agent/jobs', { method: 'POST', body: form });
  for (let i = 0; i < 120; i++) {
    const job = await api(`/agent/jobs/${start.jobId}`);
    if (job.status === 'FAILED') throw new Error(job.error);
    if (job.status === 'DRAFT_READY') return job;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Draft timed out');
}
async function approve(job: any) {
  return api(`/agent/jobs/${job.jobId}/approve`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reviewAcknowledged:true, confirmedFks:job.diff.inferred_fks.map((f:any) => f.column)}) });
}
const family = `agent_test_${Date.now()}`;
const initial = await draft(family, 'CREATE', 'CREATE TABLE depots (depot_id INTEGER PRIMARY KEY, name VARCHAR(80)); CREATE TABLE parts (part_id INTEGER PRIMARY KEY, name VARCHAR(80));');
await approve(initial);
const update = await draft(family, 'UPDATE', 'CREATE TABLE inventory (inventory_id INTEGER PRIMARY KEY, depot_id INTEGER, part_id INTEGER, quantity INTEGER); CREATE TABLE vendors (vendor_id INTEGER PRIMARY KEY, name VARCHAR(80));', 1);
assert.equal(update.diff.added_tables.length, 2);
assert.equal(update.diff.modified_tables.length, 0);
await approve(update);
const result = await api('/generate', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({family,version:2,tables:['depots','parts','inventory','vendors'],rows:{depots:20,parts:20,inventory:40,vendors:20},seed:42,format:['csv','xlsx']})});
assert.equal(result.status,'PASS',JSON.stringify(result));
assert.ok(result.files.length > 0);
console.log('HTTP integration PASS: create, review, register, add TWO tables without modifying base, register v2, generate and validate downloadable data.');