import { env } from 'cloudflare:workers';
import { accessMode, currentSession, sameOrigin } from '../../server-auth';
import { changeTeam, teamDirectory, TeamError } from '../../server-teams';

export const dynamic = 'force-dynamic';
async function authorize(request: Request, write = false) {
  if (!accessMode()) return Response.json({ error: 'Funcție disponibilă pe serverul propriu.' }, { status: 404 });
  if (write && !sameOrigin(request)) return Response.json({ error: 'Cerere neautorizată.' }, { status: 403 });
  const session = await currentSession(request);
  if (!session || session.account.passwordResetRequired) return Response.json({ error: 'Autentificare necesară.' }, { status: 401 });
  if (session.account.role !== 'Admin') return Response.json({ error: 'Acces rezervat administratorului.' }, { status: 403 });
}
export async function GET(request: Request) {
  try {
    const denied = await authorize(request); if (denied) return denied;
    return Response.json(await teamDirectory(env.DB), { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Echipele nu sunt disponibile momentan.' }, { status: 503 }); }
}
export async function POST(request: Request) {
  try {
    const denied = await authorize(request, true); if (denied) return denied;
    let body: unknown;
    try { body = await request.json(); } catch { throw new TeamError('Cerere invalidă.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TeamError('Cerere invalidă.');
    await changeTeam(env.DB, body as Record<string, unknown>);
    return Response.json(await teamDirectory(env.DB), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof TeamError ? error.message : 'Modificarea echipei nu a putut fi salvată.' }, { status: error instanceof TeamError ? error.status : 503 });
  }
}
