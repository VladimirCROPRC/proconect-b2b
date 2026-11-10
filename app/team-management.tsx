'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { Team, TeamMember } from './server-teams';

type Directory = { teams: Team[]; users: TeamMember[] };
export function TeamManagement({ onNotify, accounts, onEditEmail }: {
  onNotify: (message: string) => void;
  accounts: { username: string; email?: string }[];
  onEditEmail: (username: string) => void;
}) {
  const [data, setData] = useState<Directory>({ teams: [], users: [] });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState('*');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/teams', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as Directory & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Echipele nu au putut fi încărcate.');
        setData(payload); setError(''); setReady(true);
      }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [reload]);
  async function change(body: Record<string, unknown>, message: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/teams', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json() as Directory & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Modificarea nu a putut fi salvată.');
      setData(payload); onNotify(message); return true;
    } catch (error) { setError(error instanceof Error ? error.message : 'Modificarea nu a putut fi salvată.'); return false; }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await change({ action: editing ? 'rename' : 'create', id: editing, name }, editing ? 'Echipa a fost redenumită.' : 'Echipa a fost creată.')) { setName(''); setEditing(null); }
  }
  const users = data.users.filter(user => filter === '*' || (filter === '' ? !user.teamId : user.teamId === filter));
  return <section className="project-card team-card">
    <div className="card-heading"><div><h2>Echipe</h2><p>Creează echipe și asociază fiecare utilizator unei singure echipe.</p></div></div>
    {error && <div role="alert" style={{ padding: '16px', color: '#b42336' }}>{error}{!ready && <button className="secondary-button" onClick={() => setReload(value => value + 1)}>Reîncearcă</button>}</div>}
    {!ready && !error && <p style={{ padding: '16px' }}>Se încarcă echipele…</p>}
    {ready && <div style={{ padding: '20px', display: 'grid', gap: '20px' }}>
      <form onSubmit={save} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: '8px' }}><span>{editing ? 'Redenumește echipa' : 'Echipă nouă'}</span><input value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={80} disabled={busy} aria-label="Numele echipei" /></label>
        <button className="primary-button" disabled={busy}>{editing ? 'Salvează numele' : 'Creează echipa'}</button>
        {editing && <button type="button" className="secondary-button" disabled={busy} onClick={() => { setEditing(null); setName(''); }}>Anulează</button>}
      </form>
      {!data.teams.length && <p>Nu există echipe. Creează prima echipă, apoi selecteaz-o pentru utilizatorii de mai jos.</p>}
      {data.teams.map(team => <div key={team.id} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>{team.name}</strong><span>{team.members} utilizatori</span>
        <button className="secondary-button" disabled={busy} onClick={() => { setEditing(team.id); setName(team.name); }}>Redenumește</button>
        <button className="secondary-button" disabled={busy || team.members > 0} title={team.members ? 'Mută utilizatorii înainte de ștergere.' : 'Șterge echipa goală'} onClick={async () => {
          if (await change({ action: 'delete', id: team.id }, 'Echipa a fost ștearsă.')) {
            if (editing === team.id) { setEditing(null); setName(''); }
            if (filter === team.id) setFilter('*');
          }
        }}>Șterge</button>
      </div>)}
      <label style={{ display: 'grid', gap: '8px', maxWidth: '320px' }}><span>Filtrează utilizatorii</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="*">Toți utilizatorii</option><option value="">Fără echipă</option>{data.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <div className="account-grid">{users.map(user => <article className="account-card" key={user.username}>
        <div className="account-copy"><strong>{user.name}</strong><small>@{user.username} · {user.role}{!user.active ? ' · Inactiv' : ''}</small>
          <small>{accounts.find(account => account.username === user.username)?.email || 'Email neasociat'}</small>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => onEditEmail(user.username)} style={{ marginTop: '12px' }}>Email acces</button>
          <label style={{ display: 'grid', gap: '8px', marginTop: '12px' }}><span>Echipă</span><select aria-label={`Echipa utilizatorului ${user.username}`} value={user.teamId ?? ''} disabled={busy} onChange={event => void change({ action: 'assign', username: user.username, teamId: event.target.value || null }, 'Echipa utilizatorului a fost actualizată.')}>
            <option value="">Fără echipă</option>{data.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select></label>
        </div>
      </article>)}</div>
      {!users.length && <p>Nu există utilizatori pentru filtrul selectat.</p>}
    </div>}
  </section>;
}
