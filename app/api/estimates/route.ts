import { getRawDb } from "../../../db";
import { getAuthorizedProject, isManagementRole } from "../../project-server";
import { applyBudgetRules, buildBudgetSuggestions, normalizeBudget } from "../../project-budget";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat managementului." }, { status: 403 });
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId || !(await getAuthorizedProject(projectId, session.account))) return Response.json({ error: "Proiect indisponibil." }, { status: 404 });
    const saved = await getRawDb().prepare("SELECT content_json, updated_at FROM project_estimates WHERE project_id = ?").bind(projectId).first<{ content_json: string; updated_at: number }>();
    return Response.json({ saved: saved ? { rows: JSON.parse(saved.content_json), updatedAt: saved.updated_at } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Devizul nu este disponibil momentan." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat managementului." }, { status: 403 });
    const body = await request.json() as { projectId?: unknown; rows?: unknown; source?: unknown };
    if (typeof body.projectId !== "string") return Response.json({ error: "Proiect invalid." }, { status: 400 });
    if (!(await getAuthorizedProject(body.projectId, session.account))) return Response.json({ error: "Proiect indisponibil." }, { status: 404 });
    const rows = normalizeBudget(body.rows);
    if (!rows || JSON.stringify(rows).length > 300_000) return Response.json({ error: "Completează poziția BoQ, cantitatea și justificarea pozițiilor incluse/furnizate de beneficiar." }, { status: 400 });
    const sourceRow = await getRawDb().prepare("SELECT content_json FROM project_field_documentation WHERE project_id = ?").bind(body.projectId).first<{ content_json: string }>();
    const documentation = sourceRow ? JSON.parse(sourceRow.content_json) : {};
    const expected = buildBudgetSuggestions(documentation);
    if (body.source !== JSON.stringify(expected)) return Response.json({ error: "Datele din teren s-au schimbat. Reîncarcă proiectul înainte de salvarea devizului." }, { status: 409 });
    if (expected.some(row => !rows.some(saved => saved.id === row.id))) return Response.json({ error: "Devizul trebuie să cuprindă toate acțiunile documentate." }, { status: 400 });
    const correctedRows = applyBudgetRules(rows, expected);
    const now = Date.now();
    await getRawDb().prepare("INSERT INTO project_estimates (project_id, content_json, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET content_json = excluded.content_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .bind(body.projectId, JSON.stringify(correctedRows), session.account.username, now).run();
    return Response.json({ rows: correctedRows, updatedAt: now });
  } catch {
    return Response.json({ error: "Devizul nu a putut fi salvat." }, { status: 503 });
  }
}
