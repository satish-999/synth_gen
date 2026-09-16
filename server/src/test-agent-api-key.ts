/**
 * Feature 3 (optional per-user Anthropic API key) — the requirement that
 * matters most: the key must never be persisted to the database, written to
 * the job record, logged, or included in any error message. This test
 * exercises the real HTTP endpoint end to end and then inspects the actual
 * persisted job record (not just the HTTP response) for the raw key
 * substring.
 *
 * Run against a live dev server: SYNTHGEN_TEST_API=http://127.0.0.1:3080/api
 * (defaults to that).
 */
import assert from 'node:assert/strict';
import { redact } from './services/agentService.js';

// --- 1. redact() itself -------------------------------------------------
{
  const secret = 'sk-ant-fake1234567890';
  assert.equal(redact(`bad key ${secret} rejected`, secret), 'bad key [redacted] rejected');
  assert.equal(redact('no secret in this message', secret), 'no secret in this message');
  assert.equal(redact('message', undefined), 'message');
  // occurs more than once -- every occurrence must go
  assert.equal(redact(`${secret} and again ${secret}`, secret), '[redacted] and again [redacted]');
  console.log('redact(): PASS');
}

// --- 2. full HTTP path: the key never reaches the persisted job record ---
const base = process.env.SYNTHGEN_TEST_API ?? 'http://127.0.0.1:3080/api';
const FAKE_KEY = 'sk-ant-test-DO-NOT-USE-THIS-IS-NOT-A-REAL-KEY-abcdef123456';

async function apiRaw(url: string, init?: RequestInit) {
  return fetch(base + url, init);
}

const family = 'apikeytest_' + Date.now();
const form = new FormData();
form.append('mode', 'CREATE');
form.append('familyId', family);
form.append('displayName', 'API key persistence test');
form.append('anthropicApiKey', FAKE_KEY);
form.append('schemas', new Blob(['CREATE TABLE widgets (widget_id INTEGER PRIMARY KEY, name VARCHAR(50));']), 'widgets.sql');

const start = await apiRaw('/agent/jobs', { method: 'POST', body: form });
if (start.status !== 202) {
  throw new Error(`expected 202, got ${start.status}: ${await start.text()}`);
}
const { jobId } = (await start.json()) as { jobId: string };
console.log('>> job started:', jobId);

// Poll until it leaves PENDING/RUNNING. With a fake key this should FAIL
// fast (an auth rejection from Anthropic), but the assertion below holds
// regardless of the outcome -- what matters is the key never appears
// anywhere in the persisted record.
let job: Record<string, unknown> = {};
for (let i = 0; i < 40; i++) {
  const r = await apiRaw(`/agent/jobs/${jobId}`);
  job = (await r.json()) as Record<string, unknown>;
  if (job.status !== 'PENDING' && job.status !== 'RUNNING') break;
  await new Promise((res) => setTimeout(res, 500));
}
console.log('>> final job status (via API):', job.status, job.error ? `error: ${String(job.error).slice(0, 120)}` : '');

// The API response itself must not contain the key.
const apiResponseText = JSON.stringify(job);
assert.ok(!apiResponseText.includes(FAKE_KEY), 'the key must not appear anywhere in the GET /agent/jobs/:id response');

// The actual persisted database row -- read directly through the same
// getAgentJob() the server itself uses, which is a SELECT * -- must not
// contain the key in ANY column (job record, error message, manifest, diff).
const { getAgentJob } = await import('./db/agentJobs.js');
const raw = getAgentJob(jobId);
assert.ok(raw, 'job record must exist in the database');
const rawText = JSON.stringify(raw);
assert.ok(!rawText.includes(FAKE_KEY), `the key must not appear in any column of the persisted job record: ${rawText.slice(0, 300)}`);
console.log('>> raw DB row columns checked:', Object.keys(raw!).join(', '));
console.log('Key never persisted to the database (all columns checked): PASS');

// If a draft directory was created (only if generation somehow proceeded
// before the auth check -- unlikely, but check for completeness), the
// manifest/diff files on disk must not contain it either.
if (raw!.draft_path) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  for (const f of ['manifest.json', 'diff.json']) {
    const p = path.join(raw!.draft_path, f);
    if (fs.existsSync(p)) {
      assert.ok(!fs.readFileSync(p, 'utf8').includes(FAKE_KEY), `${f} on disk must not contain the key`);
    }
  }
  console.log('>> draft artifacts on disk checked (none contained the key)');
}

console.log('\nAPI key persistence tests: ALL PASS');
