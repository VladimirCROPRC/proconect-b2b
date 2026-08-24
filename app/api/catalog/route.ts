import { addCpe, isManagementRole } from "../../project-server";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    const body = (await request.json()) as { name?: unknown };
    if (typeof body.name !== "string") return Response.json({ error: "Completează denumirea echipamentului." }, { status: 400 });
    const result = await addCpe(body.name);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ name: result.name }, { status: 201 });
  } catch {
    return Response.json({ error: "Echipamentul nu a putut fi salvat." }, { status: 503 });
  }
}
