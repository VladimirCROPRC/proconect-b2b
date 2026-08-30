import { getRawDb } from "../../../db";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

type SiteRow = [code: string, description: string, region: string, lat: number, lon: number];

function validRow(value: unknown): value is SiteRow {
  if (!Array.isArray(value) || value.length !== 5) return false;
  const [code, description, region, lat, lon] = value;
  return typeof code === "string" && Boolean(code.trim()) &&
    typeof description === "string" && typeof region === "string" &&
    typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    typeof lon === "number" && Number.isFinite(lon) && Math.abs(lon) <= 180;
}

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    const row = await getRawDb().prepare("SELECT source_name, content_json, site_count, rejected_count, updated_at FROM map_site_dataset WHERE id = 'active'").first<{
      source_name: string; content_json: string; site_count: number; rejected_count: number; updated_at: number;
    }>();
    if (!row) return Response.json({ configured: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const sites = JSON.parse(row.content_json) as SiteRow[];
    return Response.json({
      configured: true,
      source: row.source_name,
      valid: row.site_count,
      rejected: { import: row.rejected_count },
      schema: ["code", "description", "region", "lat", "lon"],
      sites,
      updatedAt: row.updated_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Map sites read error:", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Lista site-urilor nu este disponibilă." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (session.account.role !== "Admin") return Response.json({ error: "Importul este rezervat administratorului." }, { status: 403 });
    const body = await request.json() as { source?: unknown; sites?: unknown; rejected?: unknown };
    if (typeof body.source !== "string" || !Array.isArray(body.sites)) return Response.json({ error: "Fișierul importat nu este valid." }, { status: 400 });
    if (!body.sites.length || body.sites.length > 250_000) return Response.json({ error: "Lista trebuie să conțină între 1 și 250.000 de site-uri." }, { status: 400 });
    if (!body.sites.every(validRow)) return Response.json({ error: "Lista conține coordonate sau câmpuri invalide." }, { status: 400 });
    const sites = (body.sites as SiteRow[]).map(([code, description, region, lat, lon]) => [code.trim().slice(0, 120), description.trim().slice(0, 300), region.trim().slice(0, 160), lat, lon] as SiteRow);
    const content = JSON.stringify(sites);
    if (content.length > 40_000_000) return Response.json({ error: "Fișierul este prea mare pentru import." }, { status: 413 });
    const rejected = typeof body.rejected === "number" && Number.isInteger(body.rejected) && body.rejected >= 0 ? body.rejected : 0;
    const now = Date.now();
    await getRawDb().prepare(
      "INSERT INTO map_site_dataset (id, source_name, content_json, site_count, rejected_count, updated_by, updated_at) VALUES ('active', ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source_name = excluded.source_name, content_json = excluded.content_json, site_count = excluded.site_count, rejected_count = excluded.rejected_count, updated_by = excluded.updated_by, updated_at = excluded.updated_at"
    ).bind(body.source.trim().slice(0, 240), content, sites.length, rejected, session.account.username, now).run();
    return Response.json({ source: body.source, valid: sites.length, rejected, updatedAt: now });
  } catch (error) {
    console.error("Map sites import error:", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Lista site-urilor nu a putut fi salvată." }, { status: 503 });
  }
}
