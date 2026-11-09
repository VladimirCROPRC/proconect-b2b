import { getRawDb } from "../../../db";
import { isManagementRole } from "../../project-server";
import { currentSession } from "../../server-auth";
import { reportRange, savedEstimateTotal, type TechnicianReport } from "../../technician-report";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat managementului." }, { status: 403 });
    const db = getRawDb();
    const technicians = await db.prepare("SELECT username, name FROM app_users WHERE role = 'Tehnician' UNION SELECT technician_username AS username, technician AS name FROM projects WHERE technician_username NOT IN (SELECT username FROM app_users WHERE role = 'Tehnician') UNION SELECT technician_username AS username, technician_name AS name FROM orange_oroc_tickets WHERE technician_username IS NOT NULL AND technician_username NOT IN (SELECT username FROM app_users WHERE role = 'Tehnician') ORDER BY name, username").all<{ username: string; name: string }>();
    const url = new URL(request.url), username = url.searchParams.get("technician");
    if (!username && !url.searchParams.has("from") && !url.searchParams.has("to")) return Response.json({ technicians: technicians.results ?? [] }, { headers: { "Cache-Control": "no-store" } });
    const technician = technicians.results?.find(item => item.username === username);
    const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
    const range = reportRange(from, to);
    if (!technician || !range) return Response.json({ error: "Selectează un tehnician și o perioadă validă." }, { status: 400 });
    const rows = await db.prepare("SELECT p.id, p.client, p.address, p.activity_type, p.status, p.created_at AS report_date, e.content_json AS estimate_json FROM projects p LEFT JOIN project_estimates e ON e.project_id = p.id WHERE p.technician_username = ? AND p.created_at >= ? AND p.created_at < ? ORDER BY p.created_at, p.id")
      .bind(username, range.start, range.end).all<{ id: string; client: string; address: string; activity_type: string; status: string; report_date: number; estimate_json: string | null }>();
    const undated = await db.prepare("SELECT id, client FROM projects WHERE technician_username = ? AND (created_at IS NULL OR created_at <= 0) ORDER BY id").bind(username).all<{ id: string; client: string }>();
    const works: TechnicianReport["works"] = (rows.results ?? []).map(row => {
      const total = savedEstimateTotal(row.estimate_json);
      return { id: row.id, client: row.client, address: row.address, activityType: row.activity_type, status: row.status, createdAt: row.report_date, total, estimateStatus: row.estimate_json === null ? "lipsă" : total === null ? "invalid" : "salvat" };
    });
    const orange = await db.prepare("SELECT id, ticket_number, service_package_code, created_at FROM orange_oroc_tickets WHERE technician_username = ? AND created_at >= ? AND created_at < ? ORDER BY created_at, ticket_number")
      .bind(username, range.start, range.end).all<{ id: string; ticket_number: string; service_package_code: string; created_at: number }>();
    for (const ticket of orange.results ?? []) works.push({ source: "orange-oroc", id: ticket.ticket_number, client: "Orange/OROC", address: "", activityType: "Orange/OROC", servicePackage: ticket.service_package_code, status: "Alocat", createdAt: ticket.created_at, total: null, estimateStatus: "fără valori" });
    works.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id) || (a.source ?? "project").localeCompare(b.source ?? "project"));
    const report: TechnicianReport = { technician, from, to, works, total: works.reduce((sum, work) => sum + Math.round((work.total ?? 0) * 100), 0) / 100,
      missingEstimates: works.filter(work => work.source !== "orange-oroc" && work.total === null).length, undated: undated.results ?? [] };
    return Response.json({ report }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Raportul nu este disponibil momentan." }, { status: 503 });
  }
}
