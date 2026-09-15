import assert from 'node:assert/strict';
import {validateGenerationLimits as validate, withGenerationSlot as slot} from './services/generationLimits.js';
validate(['employees'], {employees:50}, 42);
validate(['employees'], {employees:50, skills:20}, 42);
for (const rows of [{employees:0}, {employees:1.5}, {employees:50_001}, {employees:'50'}, []]) {
  assert.throws(() => validate(['employees'], rows, 42));
}
assert.throws(() => validate(['a','b','c'], {a:50_000,b:50_000,c:1}, 42));
assert.throws(() => validate(['a','a'], {}, 42));
assert.throws(() => validate(['a'], {}, -1));
let release!: () => void;
const first = slot(() => new Promise<void>(resolve => {release=resolve;}));
await assert.rejects(slot(async () => true), (e: unknown) => (e as {status:number}).status === 429);
release(); await first;
await assert.rejects(slot(async () => {throw new Error('test failure');}));
assert.equal(await slot(async () => 'available'), 'available');
console.log('Generation limits PASS: invalid counts/seeds, total cap, concurrency and release after failure.');