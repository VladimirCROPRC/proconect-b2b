import { deleteAccount, accessMode, setAccessEmail, setAccountRoles, addAccount, currentSession, listAccounts, sameOrigin } from "../../server-auth";
import { accountHasRole, normalizeAccountRoles } from "../../account-roles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (new URL(request.url).searchParams.get("technicians") === "1" && ["Admin", "Manager", "Coordonator"].includes(session.account.role)) {
      const accounts = (await listAccounts()).filter(account => accountHasRole(account, "Tehnician") && account.active)
        .map(account => ({ username: account.username, name: account.name, role: account.role, roles: account.roles, active: account.active, jobs: account.jobs }));
      return Response.json({ accounts }, { headers: { "Cache-Control": "no-store" } });
    }
    if (session.account.role !== "Admin") return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    return Response.json({ accounts: await listAccounts() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Conturile nu sunt disponibile momentan." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (session.account.role !== "Admin") return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });

    const body = (await request.json()) as { username?: unknown; name?: unknown; role?: unknown; roles?: unknown; password?: unknown; email?: unknown };
    const roles = normalizeAccountRoles(body.roles ?? [body.role]);
    if (typeof body.username !== "string" || typeof body.name !== "string" || !roles || (!accessMode() && typeof body.password !== "string")) {
      return Response.json({ error: "Completează toate câmpurile utilizatorului." }, { status: 400 });
    }

    const result = await addAccount({ username: body.username, name: body.name, role: roles[0], roles, password: typeof body.password === "string" ? body.password : "", email: typeof body.email === "string" ? body.email : undefined });
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ account: result.account }, { status: 201 });
  } catch {
    return Response.json({ error: "Contul nu a putut fi creat." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (session.account.role !== "Admin") return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    const body = await request.json() as { username?: unknown; email?: unknown; roles?: unknown };
    if (typeof body.username !== "string") return Response.json({ error: "Cont invalid." }, { status: 400 });
    const result = Object.hasOwn(body, "roles") ? await setAccountRoles(body.username, body.roles) : await setAccessEmail(body.username, body.email);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result);
  } catch { return Response.json({ error: "Modificarea contului nu a putut fi salvată." }, { status: 503 }); }
}


export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (session.account.role !== "Admin") return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    let body: { username?: unknown; confirmation?: unknown } | null;
    try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Cerere invalidă." }, { status: 400 }); }
    if (!body || typeof body.username !== "string" || body.confirmation !== body.username) return Response.json({ error: "Confirmă ștergerea introducând username-ul exact." }, { status: 400 });
    const result = await deleteAccount(body.username, session.userId);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result);
  } catch { return Response.json({ error: "Contul nu a putut fi șters." }, { status: 503 }); }
}
