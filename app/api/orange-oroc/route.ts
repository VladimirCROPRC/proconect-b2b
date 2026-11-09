import { getRawDb } from "../../../db";
import { isManagementRole } from "../../project-server";
import { currentSession, sameOrigin } from "../../server-auth";
import { validateOrangeTicket } from "../../orange-oroc-data";

export const dynamic = "force-dynamic";
type Row = { id: string; ticket_number: string; work_date: string; service_package_code: string; created_at: number; updated_at: number };
const record = (row: Row) => ({ id: row.id, ticketNumber: row.ticket_number, workDate: row.work_date, servicePackageCode: row.service_package_code, createdAt: row.created_at, updatedAt: row.updated_at });

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat coordonării." }, { status: 403 });
    const result = await getRawDb().prepare("SELECT id, ticket_number, work_date, service_package_code, created_at, updated_at FROM orange_oroc_tickets ORDER BY work_date DESC, created_at DESC, ticket_number").all<Row>();
    return Response.json({ tickets: (result.results ?? []).map(record) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Tichetele Orange/OROC nu sunt disponibile momentan." }, { status: 503 }); }
}

async function save(request: Request, editing: boolean) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Numai coordonarea poate salva tichete Orange/OROC." }, { status: 403 });
    const body = await request.json() as unknown;
    const ticket = validateOrangeTicket(body);
    if (!ticket) return Response.json({ error: "Completează numărul tichetului, o dată validă și un pachet din Services." }, { status: 400 });
    const db = getRawDb();
    let id: string = crypto.randomUUID();
    let createdAt = Date.now();
    if (editing) {
      const input = body as { id?: unknown };
      if (typeof input.id !== "string" || !input.id || input.id.length > 100) return Response.json({ error: "Tichet invalid." }, { status: 400 });
      const existing = await db.prepare("SELECT id, created_at FROM orange_oroc_tickets WHERE id = ?").bind(input.id).first<{ id: string; created_at: number }>();
      if (!existing) return Response.json({ error: "Tichetul nu mai este disponibil." }, { status: 404 });
      id = existing.id; createdAt = existing.created_at;
    }
    const duplicate = await db.prepare("SELECT id FROM orange_oroc_tickets WHERE ticket_number = ? AND id <> ?").bind(ticket.ticketNumber, id).first();
    if (duplicate) return Response.json({ error: "Numărul tichetului există deja în Orange/OROC." }, { status: 409 });
    const now = Date.now();
    if (editing) await db.prepare("UPDATE orange_oroc_tickets SET ticket_number = ?, work_date = ?, service_package_code = ?, updated_by = ?, updated_at = ? WHERE id = ?")
      .bind(ticket.ticketNumber, ticket.workDate, ticket.servicePackageCode, session.account.username, now, id).run();
    else await db.prepare("INSERT INTO orange_oroc_tickets (id, ticket_number, work_date, service_package_code, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, ticket.ticketNumber, ticket.workDate, ticket.servicePackageCode, session.account.username, createdAt, session.account.username, now).run();
    return Response.json({ ticket: { id, ...ticket, createdAt, updatedAt: now } }, { status: editing ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed.*orange_oroc_tickets.ticket_number/i.test(error.message)) return Response.json({ error: "Numărul tichetului există deja în Orange/OROC." }, { status: 409 });
    return Response.json({ error: "Tichetul Orange/OROC nu a putut fi salvat." }, { status: 503 });
  }
}
export async function POST(request: Request) { return save(request, false); }
export async function PATCH(request: Request) { return save(request, true); }
