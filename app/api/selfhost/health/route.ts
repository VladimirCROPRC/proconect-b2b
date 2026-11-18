import { getRawDb } from "../../../../db";
import { accessMode } from "../../../server-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!accessMode()) return new Response(null, { status: 404 });
  try {
    await getRawDb().prepare("SELECT 1 FROM app_user_access LIMIT 1").first();
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false }, { status: 503 }); }
}
