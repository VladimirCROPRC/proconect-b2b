import { currentSession } from "../../server-auth";
import { buildReportingWorkbook } from "../../reporting-server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (session.account.role !== "Admin") return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    const bytes = await buildReportingWorkbook();
    return new Response(bytes.buffer as ArrayBuffer, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Reporting b2b.xlsx"',
      "Cache-Control": "no-store",
    } });
  } catch { return Response.json({ error: "Centralizatorul nu a putut fi generat. Verifică devizele salvate." }, { status: 503 }); }
}
