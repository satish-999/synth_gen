import { useEffect, useState } from 'react';
import { createAgentJob } from '../api-agent';
import { metadataSampleUrls } from '../api';
import type { ActiveModel } from '../types';

export function AgentModelModal({ active, onClose, onDraft }: {
  active: ActiveModel | null; onClose: () => void; onDraft: (id: string) => void;
}) {
  const [mode, setMode] = useState<'CREATE' | 'UPDATE'>('CREATE');
  const [family, setFamily] = useState('');
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [ai, setAi] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/agent/capabilities').then(async r => {
      if (!r.ok) throw new Error('Unable to check agent configuration.');
      setAi((await r.json()).aiConfigured);
    }).catch(e => setError(e.message));
  }, []);
  // A key typed here makes Claude available for this request even when the
  // server has none configured. It is sent with this submission only — see
  // submit() below — never saved in this component's state beyond the
  // lifetime of the modal, never written anywhere by the server either.
  const aiAvailable = ai || apiKey.trim().length > 0;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('mode', mode);
      form.append('familyId', mode === 'UPDATE' ? active!.family : family);
      form.append('displayName', mode === 'UPDATE' ? active!.displayName : name || family);
      if (mode === 'UPDATE') form.append('baseVersion', String(active!.version));
      form.append('domainHint', instructions);
      if (apiKey.trim()) form.append('anthropicApiKey', apiKey.trim());
      files.forEach(f => form.append('schemas', f));
      const job = await createAgentJob(form);
      onDraft(job.jobId);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const documents = files.some(f => /\.(pdf|docx)$/i.test(f.name));
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="agent-title">
    <h2 id="agent-title">Model authoring agent</h2>
    <p className="hint">Upload metadata, review the proposed tables and relationships, then register a version.</p>
    <p className="hint">{ai === null ? 'Checking agent availability…' : ai ? 'Claude is configured. Uploaded metadata and your instructions will be sent to Anthropic to draft the model.' : 'Local schema mode. Structured Markdown metadata, SQL, JSON, CSV and Excel schemas work without an API key. Free-form documents and instructions require Claude — supply your own key below, or ask an admin to configure the server.'}</p>
    <form onSubmit={submit}>
      <label>Action<select value={mode} onChange={e => setMode(e.target.value as 'CREATE' | 'UPDATE')}>
        <option value="CREATE">Create a new model</option>
        {active && <option value="UPDATE">Add tables to {active.displayName} v{active.version}</option>}
      </select></label>
      {mode === 'CREATE' ? <>
        <label>Model ID<input required pattern="[a-z][a-z0-9_-]*" value={family} onChange={e => setFamily(e.target.value)} placeholder="workforce" /></label>
        <label>Display name<input value={name} onChange={e => setName(e.target.value)} placeholder="Workforce planning" /></label>
      </> : <p className="hint">Existing tables and rules are preserved. Upload only the new tables or their descriptions.</p>}
      <label>Metadata files<input type="file" multiple required accept=".xlsx,.xls,.csv,.sql,.ddl,.json,.pdf,.docx,.txt,.md" onChange={e => setFiles(Array.from(e.target.files || []))} /></label>
      <p className="hint">Up to 20 files, 10 MB each. PDF files must contain selectable text.</p>
      <p className="hint">
        These describe tables you want built — not a finished model. Same sample table, four formats:{' '}
        {metadataSampleUrls().map((s, i) => <span key={s.url}>{i > 0 && ' · '}<a href={s.url} download>{s.label}</a></span>)}
      </p>
      <label>Instructions<textarea maxLength={10000} value={instructions} disabled={!aiAvailable} onChange={e => setInstructions(e.target.value)} placeholder="Add departments and locations, with relationships to the existing tables." /></label>
      <label>Your Anthropic API key <span className="hint">(optional)</span>
        <input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={ai ? 'sk-ant-… — leave blank to use the server key' : 'sk-ant-… — required here if the server has none configured'} />
      </label>
      <p className="hint">
        Only needed if you want to use your own Anthropic account for this request instead of the server's key
        (or the server has none). Used once for this draft and discarded — never saved, logged, or shown again.
      </p>
      {documents && !aiAvailable && <p className="banner bad">Document uploads require the AI connection. Choose structured schemas, supply your own API key above, or ask an admin to configure the server.</p>}
      {error && <p className="banner bad" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="go" disabled={busy || !files.length || ai === null || (documents && !aiAvailable)}>{busy ? 'Submitting…' : 'Create draft for review'}</button></div>
    </form>
  </div></div>;
}