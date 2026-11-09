import { getRawDb } from "../../../db";
import { currentSession } from "../../server-auth";
import { isManagementRole } from "../../project-server";
import { reportRange } from "../../technician-report";
import { buildDailyReport, type DailyPhoto, type DailyProject, type DailyTicket } from "../../daily-technician-report";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat managementului." }, { status: 403 });
    const url = new URL(request.url), username = url.searchParams.get("technician") ?? "", from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
    if (!username || !reportRange(from, to)) return Response.json({ error: "Selectează tehnicianul și o perioadă validă." }, { status: 400 });
    const db = getRawDb();
    const users = await db.prepare("SELECT username, name FROM app_users WHERE username = ? AND role = 'Tehnician' UNION SELECT technician_username AS username, technician AS name FROM projects WHERE technician_username = ? UNION SELECT technician_username AS username, technician_name AS name FROM orange_oroc_tickets WHERE technician_username = ?").bind(username, username, username).all<{ username: string; name: string }>();
    const technician = users.results?.[0];
    if (!technician) return Response.json({ error: "Tehnician indisponibil." }, { status: 400 });
    const projects = await db.prepare("SELECT p.id, p.client, p.technician_username AS assignedUsername, d.content_json AS documentation, e.content_json AS estimate FROM projects p LEFT JOIN project_field_documentation d ON d.project_id = p.id LEFT JOIN project_estimates e ON e.project_id = p.id WHERE p.technician_username = ? OR EXISTS (SELECT 1 FROM project_files f WHERE f.project_id = p.id AND f.uploaded_by = ? AND f.content_type LIKE 'image/%')").bind(username, username).all<DailyProject>();
    // Read every photo, then pick the last per operation BEFORE filtering the dates.
    const photos = await db.prepare("SELECT project_id AS projectId, section, category, uploaded_by AS uploadedBy, created_at AS uploadedAt, captured_at AS capturedAt FROM project_files WHERE uploaded_by = ? AND content_type LIKE 'image/%'").bind(username).all<DailyPhoto>();
    const tickets = await db.prepare("SELECT id, ticket_number AS ticketNumber, work_date AS workDate, service_package_code AS packageCode, technician_username AS technicianUsername FROM orange_oroc_tickets WHERE technician_username = ? AND work_date >= ? AND work_date <= ?").bind(username, from, to).all<DailyTicket>();
    const report = buildDailyReport({ technician, from, to, projects: projects.results ?? [], photos: photos.results ?? [], tickets: tickets.results ?? [] });
    return Response.json({ report }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Raportul zilnic nu este disponibil momentan." }, { status: 503 }); }
}
