import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const output = new URL('../../examples', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const base = process.env.SYNTHGEN_TEST_API ?? 'http://127.0.0.1:3080/api';
const family = 'incremental_check_' + Date.now();
async function api(url, options) {
  const res = await fetch(base + url, options);
  const body = await res.json();
  assert.ok(res.ok, JSON.stringify(body)); return body;
}
async function upload(file, mode, version) {
  const form = new FormData(); form.append('familyId',family); form.append('displayName','Verified workforce sample'); form.append('mode',mode);
  if (version) form.append('baseVersion',version);
  form.append('schemas',new Blob([await fs.readFile(output+'/'+file)]),file);
  const start = await api('/agent/jobs',{method:'POST',body:form});
  for(let i=0;i<120;i++) {
    const job = await api('/agent/jobs/'+start.jobId);
    if(job.status==='FAILED') throw new Error(job.error);
    if(job.status==='DRAFT_READY') return job;
    await new Promise(r=>setTimeout(r,500));
  } throw new Error('Draft timed out');
}
async function register(job) {
  return api(`/agent/jobs/${job.jobId}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewAcknowledged:true,confirmedFks:job.diff.inferred_fks.map(f=>f.column)})});
}
const job = await upload('workforce_sample_metadata.md','CREATE');
assert.equal(Object.keys(job.manifest.tables).length,4);
await register(job);
const rows = {roles:10,employees:50,projects:12,assignments:100};
const result = await api('/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({family,version:1,tables:Object.keys(rows),rows,seed:42,format:['csv','xlsx']})});
assert.equal(result.status,'PASS',JSON.stringify(result));
const zip = await fetch(base+`/generate/${result.runId}/download`);
assert.ok(zip.ok);
await zip.arrayBuffer();
const update = await upload('workforce_add_two_tables.md','UPDATE','1');
assert.equal(update.diff.added_tables.length,2);
assert.equal(update.diff.modified_tables.length,0);
await register(update);
const preserved = await fs.readFile(result.outputPath + '/employees.csv');
const partialRequest = {family,version:2,tables:['skills','employee_skills'],rows:{skills:20,employee_skills:120},seed:73,format:['xlsx']};
const evolved = await api('/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(partialRequest)});
assert.equal(evolved.status,'PASS',JSON.stringify(evolved));
assert.equal(evolved.referencedFromRun,result.runId);
assert.deepEqual(Object.keys(evolved.targets).sort(),['employee_skills','skills']);
assert.deepEqual(evolved.files,['synthetic_data.xlsx']);
assert.deepEqual(await fs.readFile(result.outputPath+'/employees.csv'),preserved);
assert.ok(evolved.compliance.checks.some(c=>c.name.includes('employee_skills.employee_id: FK') && c.pass));
// Reuse the Excel-only partial run, including its original parent references.
const repeated = await api('/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...partialRequest,tables:['employee_skills'],format:['csv']})});
assert.equal(repeated.status,'PASS',JSON.stringify(repeated));
assert.equal(repeated.referencedFromRun,evolved.runId);
assert.deepEqual(repeated.files,['employee_skills.csv']);
assert.deepEqual(await fs.readFile(result.outputPath+'/employees.csv'),preserved);
console.log(JSON.stringify({result:'PASS',family,baseRun:result.runId,partialRun:evolved.runId,repeatedRun:repeated.runId,checks:evolved.compliance.checks.length,priorEmployeesUnchanged:true,onlyNewTablesGenerated:true}));