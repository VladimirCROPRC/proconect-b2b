import { currentSession } from "../../server-auth";
import { buildReportingWorkbook } from "../../reporting-server";
import { reportingFilename, validReportingMonth } from "../../reporting-workbook";
import { localDate } from "../../technician-report";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (session.account.role !== "Admin") return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    const month = new URL(request.url).searchParams.get("month") ?? localDate(Date.now()).slice(0, 7);
    if (!validReportingMonth(month)) return Response.json({ error: "Lună invalidă. Folosește formatul AAAA-LL." }, { status: 400 });
    const bytes = await buildReportingWorkbook(month);
    return new Response(bytes.buffer as ArrayBuffer, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${reportingFilename(month)}"`,
      "Cache-Control": "no-store",
    } });
  } catch { return Response.json({ error: "Centralizatorul nu a putut fi generat. Verifică devizele salvate." }, { status: 503 }); }
}
