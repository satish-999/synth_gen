import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import XLSX from 'xlsx';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synthgen-plan-'));
process.env.RUNS_PATH = path.join(root, 'runs');
process.env.REGISTRY_PATH = path.join(root, 'registry');
const {insertRun} = await import('./dist/db/sqlite.js');
const {planPartialGeneration} = await import('./dist/services/generationPlan.js');
function workbook(family, version, pattern = 'OLD-####') {
  const dir = path.join(process.env.REGISTRY_PATH, family, 'v'+version);
  fs.mkdirSync(dir,{recursive:true});
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['column_name','dtype','pk','fk_ref','fk_mode','cardinality','orphan_pct','generator','params','nullable_pct','unique'],
    ['parent_id','string','Y','','','',0,'pattern','pattern='+pattern,0,'Y']
  ]), 'parents');
  const file = path.join(dir,'data_model.xlsx'); XLSX.writeFile(wb,file); return file;
}
const v1=workbook('test',1), v2=workbook('test',2), v3=workbook('test',3,'NEW-####');
const other=workbook('other',1);
function run(id,key,modelPath,hasData,status='PASS') {
  const output=path.join(root,id); fs.mkdirSync(output);
  if(hasData) fs.writeFileSync(path.join(output,'parents.csv'),'parent_id\nOLD-0001\n');
  insertRun({run_id:id,model_key:key,model_path:modelPath,seed:42,locale:'en_US',targets:'{}',formats:'["csv"]',status,report:null,output_path:output,files:null,error:null,created_at:id});
}
const plan=version=>planPartialGeneration(['children'],['children','parents'],'test@v'+version,99);
assert.throws(()=>plan(2),/No compatible saved dataset/);
run('1','test@v1',v1,true);
run('2','test@v2',v2,false);
run('3','other@v1',other,true);
run('4','test@v2',v2,true,'FAIL');
assert.equal(plan(2).referencedFromRun,'1');
assert.throws(()=>plan(3),/No compatible saved dataset/);
console.log('Planner regression PASS: cross-version reuse, missing files, changed schema, different family and failed run exclusion.');