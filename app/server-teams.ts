export type Team = { id: string; name: string; members: number };
export type TeamMember = { username: string; name: string; role: string; active: number; teamId: string | null };
export class TeamError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function teamDirectory(db: D1Database) {
  const teams = await db.prepare('SELECT t.id, t.name, COUNT(m.user_id) AS members FROM app_teams t LEFT JOIN app_team_members m ON m.team_id=t.id GROUP BY t.id ORDER BY t.name COLLATE NOCASE').all<Team>();
  const users = await db.prepare('SELECT u.username, u.name, u.role, u.active, m.team_id AS teamId FROM app_users u LEFT JOIN app_team_members m ON m.user_id=u.id ORDER BY u.name, u.username').all<TeamMember>();
  return { teams: teams.results ?? [], users: users.results ?? [] };
}

export async function changeTeam(db: D1Database, body: Record<string, unknown>) {
  if (body.action === 'assign') {
    if (typeof body.username !== 'string' || (body.teamId !== null && typeof body.teamId !== 'string')) throw new TeamError('Selectează utilizatorul și echipa.');
    const user = await db.prepare('SELECT id FROM app_users WHERE username=?').bind(body.username).first<{ id: string }>();
    if (!user) throw new TeamError('Utilizatorul nu există.', 404);
    if (body.teamId === null) {
      await db.prepare('DELETE FROM app_team_members WHERE user_id=?').bind(user.id).run();
    } else {
      const team = await db.prepare('SELECT id FROM app_teams WHERE id=?').bind(body.teamId).first();
      if (!team) throw new TeamError('Echipa nu mai există. Reîncarcă lista.', 404);
      await db.prepare('INSERT INTO app_team_members(user_id,team_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET team_id=excluded.team_id').bind(user.id, body.teamId).run();
    }
    return;
  }
  if (!['create', 'rename', 'delete'].includes(String(body.action))) throw new TeamError('Acțiune invalidă.');
  if (body.action !== 'create') {
    if (typeof body.id !== 'string') throw new TeamError('Echipă invalidă.');
    if (!await db.prepare('SELECT id FROM app_teams WHERE id=?').bind(body.id).first()) throw new TeamError('Echipa nu există.', 404);
  }
  if (body.action === 'delete') {
    const result = await db.prepare('DELETE FROM app_teams WHERE id=? AND NOT EXISTS (SELECT 1 FROM app_team_members WHERE team_id=?)').bind(body.id, body.id).run();
    if (!result.meta.changes) throw new TeamError('Mută utilizatorii sau selectează „Fără echipă” înainte de a șterge echipa.', 409);
    return;
  }
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 80) throw new TeamError('Numele echipei trebuie să aibă între 2 și 80 de caractere.');
  const nameKey = name.normalize('NFKC').toLocaleLowerCase('ro-RO');
  try {
    if (body.action === 'create') await db.prepare('INSERT INTO app_teams(id,name,name_key) VALUES (?,?,?)').bind(crypto.randomUUID(), name, nameKey).run();
    else await db.prepare('UPDATE app_teams SET name=?,name_key=? WHERE id=?').bind(name, nameKey, body.id).run();
  } catch (error) {
    if (/UNIQUE constraint failed: app_teams.name_key/.test(String(error))) throw new TeamError('Există deja o echipă cu acest nume.', 409);
    throw error;
  }
}
