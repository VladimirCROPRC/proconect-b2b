import { getAuthorizedProject, getFileRow, hasValidPhotoCoordinates, isManagementRole, listProjectFiles, removeFile, storeFile, validateUpload } from "../../project-server";
import { syncFileIfConnected } from "../../google-drive-server";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const section = url.searchParams.get("section") ?? undefined;
    if (!projectId) return Response.json({ error: "Proiectul nu a fost selectat." }, { status: 400 });
    if (section === "documents" && !isManagementRole(session.account)) return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    if (!(await getAuthorizedProject(projectId, session.account))) return Response.json({ error: "Proiect indisponibil." }, { status: 404 });
    const files = await listProjectFiles(projectId, section);
    return Response.json({ files: isManagementRole(session.account) ? files : files.filter((file: { section: string }) => file.section !== "documents") }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Proconect file list error:", error instanceof Error ? error.message : "Unknown file failure");
    return Response.json({ error: "Fișierele nu sunt disponibile momentan." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    const form = await request.formData();
    const projectId = form.get("projectId");
    const section = form.get("section");
    const category = form.get("category");
    const file = form.get("file");
    const geo = form.get("geo");
    if (typeof projectId !== "string" || typeof section !== "string" || typeof category !== "string" || !(file instanceof File)) {
      return Response.json({ error: "Datele fișierului nu sunt complete." }, { status: 400 });
    }
    if ((section === "project" || section === "documents") && !isManagementRole(session.account)) {
      return Response.json({ error: "Încărcarea documentelor proiectului este rezervată administratorului." }, { status: 403 });
    }
    const project = await getAuthorizedProject(projectId, session.account);
    if (!project) return Response.json({ error: "Proiect indisponibil." }, { status: 404 });
    if (section === "intervention-assessment" || section === "intervention-execution") {
      if (project.activity_type !== "Intervenție") {
        return Response.json({ error: "Aceste fotografii sunt disponibile numai pentru intervenții." }, { status: 400 });
      }
      if (typeof geo !== "string" || !hasValidPhotoCoordinates(geo)) {
        return Response.json({ error: "Fotografiile intervenției necesită coordonate GPS valide." }, { status: 400 });
      }
      if ((section === "intervention-assessment" && category !== "damage") || (section === "intervention-execution" && !/^[a-f0-9-]{36}:photo$/i.test(category))) {
        return Response.json({ error: "Categoria fotografiei intervenției nu este validă." }, { status: 400 });
      }
    }
    const validation = validateUpload(section, category, file);
    if (validation) return Response.json({ error: validation }, { status: 400 });
    const result = await storeFile({ projectId, section, category, file, geo: typeof geo === "string" ? geo.slice(0, 250) : "", uploadedBy: session.account.username });
    try {
      await syncFileIfConnected(result.id);
    } catch (error) {
      console.error("Proconect Drive file sync error:", error instanceof Error ? error.message : "Unknown Drive file sync failure");
    }
    return Response.json({ file: result }, { status: 201 });
  } catch (error) {
    console.error("Proconect file upload error:", error instanceof Error ? error.message : "Unknown file failure");
    return Response.json({ error: "Fișierul nu a putut fi încărcat." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    const body = (await request.json()) as { fileId?: unknown };
    if (typeof body.fileId !== "string") return Response.json({ error: "Fișierul nu a fost selectat." }, { status: 400 });
    const file = await getFileRow(body.fileId);
    if (!file || !(await getAuthorizedProject(file.project_id, session.account))) return Response.json({ error: "Fișier indisponibil." }, { status: 404 });
    if ((file.section === "project" || file.section === "documents") && !isManagementRole(session.account)) {
      return Response.json({ error: "Ștergerea acestui document este rezervată administratorului." }, { status: 403 });
    }
    await removeFile(body.fileId);
    return Response.json({ removed: true });
  } catch {
    return Response.json({ error: "Fișierul nu a putut fi șters." }, { status: 503 });
  }
}
