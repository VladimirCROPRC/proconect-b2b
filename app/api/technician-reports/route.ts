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
    const technicians = await db.prepare("SELECT username, name FROM app_users WHERE role = 'Tehnician' UNION SELECT technician_username AS username, technician AS name FROM projects WHERE technician_username NOT IN (SELECT username FROM app_users WHERE role = 'Tehnician') ORDER BY name, username").all<{ username: string; name: string }>();
    const url = new URL(request.url), username = url.searchParams.get("technician");
    if (!username && !url.searchParams.has("from") && !url.searchParams.has("to")) return Response.json({ technicians: technicians.results ?? [] }, { headers: { "Cache-Control": "no-store" } });
    const technician = technicians.results?.find(item => item.username === username);
    const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
    const range = reportRange(from, to);
    if (!technician || !range) return Response.json({ error: "Selectează un tehnician și o perioadă validă." }, { status: 400 });
    // Finalization date means upload time of the assigned technician's latest
    // image. Admin uploads, documents and capture timestamps do not define it.
    const rows = await db.prepare("SELECT p.id, p.client, p.address, p.activity_type, photo.completed_at, e.content_json AS estimate_json FROM projects p JOIN (SELECT project_id, uploaded_by, MAX(created_at) AS completed_at FROM project_files WHERE uploaded_by = ? AND content_type LIKE 'image/%' AND created_at > 0 GROUP BY project_id, uploaded_by) photo ON photo.project_id = p.id AND photo.uploaded_by = p.technician_username LEFT JOIN project_estimates e ON e.project_id = p.id WHERE p.technician_username = ? AND p.status = 'Finalizat' AND photo.completed_at >= ? AND photo.completed_at < ? ORDER BY photo.completed_at, p.id")
      .bind(username, username, range.start, range.end).all<{ id: string; client: string; address: string; activity_type: string; completed_at: number; estimate_json: string | null }>();
    const undated = await db.prepare("SELECT p.id, p.client FROM projects p WHERE p.technician_username = ? AND p.status = 'Finalizat' AND NOT EXISTS (SELECT 1 FROM project_files f WHERE f.project_id = p.id AND f.uploaded_by = p.technician_username AND f.content_type LIKE 'image/%' AND f.created_at > 0) ORDER BY p.id").bind(username).all<{ id: string; client: string }>();
    const works: TechnicianReport["works"] = (rows.results ?? []).map(row => {
      const total = savedEstimateTotal(row.estimate_json);
      return { id: row.id, client: row.client, address: row.address, activityType: row.activity_type, completedAt: row.completed_at, total, estimateStatus: row.estimate_json === null ? "lipsă" : total === null ? "invalid" : "salvat" };
    });
    const report: TechnicianReport = { technician, from, to, works, total: works.reduce((sum, work) => sum + Math.round((work.total ?? 0) * 100), 0) / 100,
      missingEstimates: works.filter(work => work.total === null).length, undated: undated.results ?? [] };
    return Response.json({ report }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Raportul nu este disponibil momentan." }, { status: 503 });
  }
}
