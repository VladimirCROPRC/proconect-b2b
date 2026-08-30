import { env } from "cloudflare:workers";
import { getRawDb } from "../db";
import { bucket, getFileRow } from "./project-server";
import { buildAcceptanceReportDocx } from "./report-docx";
import { buildSpliceSheetXlsx } from "./splice-xlsx";
import { base64url, decode64, fixedOrigin, retryDelay, safeName, usesOneDrive, validMode, type BackupMode } from "./onedrive-core";

type Environment = { PROCONECT_APP_URL?: string; ONEDRIVE_CLIENT_ID?: string; ONEDRIVE_TENANT_ID?: string; ONEDRIVE_CLIENT_SECRET?: string; ONEDRIVE_ENCRYPTION_KEY?: string };
type Connection = { mode: BackupMode; generation: string; access_token: string; refresh_token: string; expires_at: number; drive_id: string; root_id: string; root_url: string; account: string; owner_id: string; lease: string; lease_until: number };
type Job = { id: string; kind: "file" | "project"; item_id: string; revision: number; attempts: number };
type Item = { id: string; webUrl?: string; folder?: object; driveType?: string; owner?: { user?: { id?: string; displayName?: string; email?: string } } };
const encoder = new TextEncoder();
const settingsId = "onedrive";
const scope = "offline_access https://graph.microsoft.com/Files.ReadWrite";
const environment = () => env as unknown as Environment;
export function oneDriveConfigured() {
  const e = environment();
  return Boolean(e.PROCONECT_APP_URL && e.ONEDRIVE_CLIENT_ID && e.ONEDRIVE_TENANT_ID && e.ONEDRIVE_CLIENT_SECRET && e.ONEDRIVE_ENCRYPTION_KEY);
}
function config() {
  const e = environment();
  if (!oneDriveConfigured()) throw new Error("Configurează variabilele OneDrive în Cloudflare înainte de conectare.");
  const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!guid.test(e.ONEDRIVE_CLIENT_ID!) || !guid.test(e.ONEDRIVE_TENANT_ID!) || !/^[a-f0-9]{64}$/i.test(e.ONEDRIVE_ENCRYPTION_KEY!)) throw new Error("Configurarea OneDrive nu este validă.");
  return { client: e.ONEDRIVE_CLIENT_ID!, tenant: e.ONEDRIVE_TENANT_ID!, secret: e.ONEDRIVE_CLIENT_SECRET!, key: e.ONEDRIVE_ENCRYPTION_KEY!, origin: fixedOrigin(e.PROCONECT_APP_URL!) };
}
async function cryptKey() {
  return crypto.subtle.importKey("raw", Uint8Array.from(config().key.match(/../g)!, n => parseInt(n, 16)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode("proconect-onedrive-v1") }, await cryptKey(), encoder.encode(value));
  return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}
async function unseal(value: string) {
  const [iv, ciphertext] = value.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode64(iv), additionalData: encoder.encode("proconect-onedrive-v1") }, await cryptKey(), decode64(ciphertext)));
}
async function connection() {
  return getRawDb().prepare("SELECT * FROM onedrive_connection WHERE id = ?").bind(settingsId).first<Connection>();
}
export async function backupMode(): Promise<BackupMode> {
  // A rollout without OneDrive secrets must keep the existing Google integration working.
  if (!oneDriveConfigured()) return "google";
  return (await connection())?.mode ?? "google";
}
export function oneDriveSameOrigin(request: Request) {
  try { return request.headers.get("Origin") === config().origin; } catch { return false; }
}
class RemoteFailure extends Error {
  constructor(message: string, public delay = 30_000) { super(message); }
}
async function exchange(parameters: URLSearchParams) {
  const c = config();
  parameters.set("client_id", c.client); parameters.set("client_secret", c.secret);
  let response: Response;
  try {
    response = await fetch(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, { method: "POST", body: parameters, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new RemoteFailure("MICROSOFT_TOKEN:network");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: unknown };
    const allowed = new Set(["invalid_client", "invalid_grant", "invalid_scope", "unauthorized_client", "interaction_required", "temporarily_unavailable"]);
    const code = typeof payload.error === "string" && allowed.has(payload.error) ? payload.error : "other";
    throw new RemoteFailure(`MICROSOFT_TOKEN:${code}`);
  }
  const tokens = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tokens.access_token) throw new RemoteFailure("Microsoft nu a returnat un token valid.");
  return tokens;
}
async function graph(token: string, path: string, options: RequestInit = {}) {
  if (!path.startsWith("/me/drive")) throw new Error("Adresă Graph nepermisă.");
  const headers = new Headers(options.headers); headers.set("Authorization", `Bearer ${token}`);
  return fetch(`https://graph.microsoft.com/v1.0${path}`, { ...options, headers, signal: AbortSignal.timeout(20_000) });
}
async function checked(response: Response): Promise<Item> {
  if (!response.ok) throw new RemoteFailure(`OneDrive: operațiunea a eșuat (HTTP ${response.status}).${response.status === 401 || response.status === 403 ? " Reconectează contul sau solicită aprobarea IT." : ""}`, retryDelay(0, response.headers.get("Retry-After")));
  return response.json() as Promise<Item>;
}
async function folder(token: string, parent: string, name: string) {
  const path = `/me/drive/items/${encodeURIComponent(parent)}`;
  const lookup = () => graph(token, `${path}:/${encodeURIComponent(name)}`);
  let response = await lookup();
  if (response.status === 404) {
    response = await graph(token, `${path}/children`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }) });
    if (response.status === 409) response = await lookup();
  }
  const item = await checked(response);
  if (!item.id || !item.folder) throw new Error("Destinația OneDrive nu este un dosar.");
  return item;
}
export async function beginOneDrive(sessionId: string) {
  const c = config();
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
  await getRawDb().batch([
    getRawDb().prepare("DELETE FROM onedrive_oauth_states WHERE expires_at < ? OR session_id = ?").bind(Date.now(), sessionId),
    getRawDb().prepare("INSERT INTO onedrive_oauth_states (id, session_id, verifier, expires_at) VALUES (?, ?, ?, ?)").bind(state, sessionId, await seal(verifier), Date.now() + 600_000),
  ]);
  const parameters = new URLSearchParams({ client_id: c.client, redirect_uri: `${c.origin}/api/onedrive/callback`, response_type: "code", response_mode: "query", scope, state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" });
  return `https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/authorize?${parameters}`;
}
async function oneDriveStage<T>(name: string, action: () => Promise<T>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("MICROSOFT_TOKEN:")) throw error;
    throw new Error(`ONEDRIVE_STAGE:${name}`);
  }
}
export async function finishOneDrive(sessionId: string, state: string, code: string) {
  const c = config();
  // DELETE RETURNING atomically consumes state, bound to the current app session.
  const authorization = await oneDriveStage("state-db", () => getRawDb().prepare("DELETE FROM onedrive_oauth_states WHERE id = ? AND session_id = ? AND expires_at > ? RETURNING verifier").bind(state, sessionId, Date.now()).first<{ verifier: string }>());
  if (!authorization) throw new Error("Autorizarea a expirat sau a fost deja folosită. Reîncearcă din aplicație.");
  const verifier = await oneDriveStage("state-decrypt", () => unseal(authorization.verifier));
  const tokens = await oneDriveStage("token", () => exchange(new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: `${c.origin}/api/onedrive/callback`, scope })));
  if (!tokens.refresh_token) throw new Error("Microsoft nu a acordat acces pentru sincronizarea în fundal.");
  const drive = await oneDriveStage("drive", async () => checked(await graph(tokens.access_token!, "/me/drive")));
  if (drive.driveType !== "business" || !drive.id) throw new Error("Conectează contul OneDrive de serviciu Microsoft 365.");
  const existing = await oneDriveStage("connection-db", () => connection());
  if (existing?.drive_id && existing.drive_id !== drive.id) throw new Error("Este conectat alt OneDrive. Deconectează-l explicit înainte de schimbarea contului.");
  const root = await oneDriveStage("root", async () => checked(await graph(tokens.access_token!, "/me/drive/root")));
  const destination = await oneDriveStage("folder", () => folder(tokens.access_token!, root.id, "Proconect B2B"));
  const generation = crypto.randomUUID();
  await oneDriveStage("save-db", async () => {
    const accessToken = await seal(tokens.access_token!);
    const refreshToken = await seal(tokens.refresh_token!);
    return getRawDb().prepare("INSERT INTO onedrive_connection (id, mode, generation, access_token, refresh_token, expires_at, drive_id, root_id, root_url, account, owner_id, lease, lease_until) VALUES (?, 'google', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0) ON CONFLICT(id) DO UPDATE SET generation = excluded.generation, access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, drive_id = excluded.drive_id, root_id = excluded.root_id, root_url = excluded.root_url, account = excluded.account, owner_id = excluded.owner_id, lease = '', lease_until = 0")
      .bind(settingsId, generation, accessToken, refreshToken, Date.now() + (tokens.expires_in ?? 3600) * 1000, drive.id, destination.id, destination.webUrl ?? "", drive.owner?.user?.email ?? drive.owner?.user?.displayName ?? "OneDrive Microsoft 365", drive.owner?.user?.id ?? "").run();
  });
}
export async function setBackupMode(value: unknown) {
  if (!validMode(value)) throw new Error("Destinație de salvare invalidă.");
  const c = await connection();
  if (usesOneDrive(value) && !c?.refresh_token) throw new Error("Conectează mai întâi OneDrive.");
  if (!c) return;
  await getRawDb().prepare("UPDATE onedrive_connection SET mode = ? WHERE id = ?").bind(value, settingsId).run();
  if (usesOneDrive(value)) await seedOneDrive();
}
export async function disconnectOneDrive() {
  await getRawDb().batch([
    getRawDb().prepare("DELETE FROM onedrive_oauth_states"),
    getRawDb().prepare("DELETE FROM onedrive_jobs"),
    getRawDb().prepare("DELETE FROM onedrive_connection"),
  ]);
  // Remote archives are deliberately retained. Revoke consent separately in Microsoft.
}
export async function queueOneDrive(kind: "file" | "project", id: string) {
  if (!usesOneDrive(await backupMode())) return;
  await getRawDb().prepare("INSERT INTO onedrive_jobs (id, kind, item_id, revision, done_revision, attempts, next_at, last_error) VALUES (?, ?, ?, 1, 0, 0, 0, '') ON CONFLICT(id) DO UPDATE SET revision = revision + 1, attempts = 0, next_at = 0, last_error = ''")
    .bind(`${kind}:${id}`, kind, id).run();
}
export async function seedOneDrive() {
  if (!usesOneDrive(await backupMode())) return;
  await getRawDb().batch([
    getRawDb().prepare("INSERT OR IGNORE INTO onedrive_jobs (id, kind, item_id) SELECT 'file:' || id, 'file', id FROM project_files"),
    getRawDb().prepare("INSERT OR IGNORE INTO onedrive_jobs (id, kind, item_id) SELECT 'project:' || id, 'project', id FROM projects"),
  ]);
}
export async function retryOneDrive() {
  await seedOneDrive();
  await getRawDb().batch([
    getRawDb().prepare("DELETE FROM onedrive_jobs WHERE kind = 'file' AND NOT EXISTS (SELECT 1 FROM project_files WHERE project_files.id = onedrive_jobs.item_id)"),
    getRawDb().prepare("DELETE FROM onedrive_jobs WHERE kind = 'project' AND NOT EXISTS (SELECT 1 FROM projects WHERE projects.id = onedrive_jobs.item_id)"),
    getRawDb().prepare("UPDATE onedrive_jobs SET revision = revision + 1, attempts = 0, next_at = 0, last_error = '' WHERE (kind = 'file' AND EXISTS (SELECT 1 FROM project_files WHERE project_files.id = onedrive_jobs.item_id)) OR (kind = 'project' AND EXISTS (SELECT 1 FROM projects WHERE projects.id = onedrive_jobs.item_id))"),
  ]);
}
export async function oneDriveStatus() {
  const configured = oneDriveConfigured();
  if (!configured) return { configured: false, connected: false, mode: "google", account: "", rootUrl: "", synced: 0, pending: 0, errors: [] };
  config();
  const c = await connection();
  const counts = await getRawDb().prepare("SELECT SUM(CASE WHEN done_revision = revision THEN 1 ELSE 0 END) AS synced, SUM(CASE WHEN done_revision < revision THEN 1 ELSE 0 END) AS pending FROM onedrive_jobs").first<{ synced: number; pending: number }>();
  const errors = await getRawDb().prepare("SELECT kind, item_id, last_error FROM onedrive_jobs WHERE last_error != '' ORDER BY next_at LIMIT 10").all();
  return { configured, connected: Boolean(c?.refresh_token), mode: c?.mode ?? "google", account: c?.account ?? "", rootUrl: c?.root_url ?? "", synced: counts?.synced ?? 0, pending: counts?.pending ?? 0, errors: errors.results ?? [] };
}
async function tokenFor(c: Connection) {
  if (c.expires_at > Date.now() + 60_000) return unseal(c.access_token);
  const tokens = await exchange(new URLSearchParams({ grant_type: "refresh_token", refresh_token: await unseal(c.refresh_token), scope }));
  const result = await getRawDb().prepare("UPDATE onedrive_connection SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ? AND generation = ? AND lease = ?")
    .bind(await seal(tokens.access_token!), tokens.refresh_token ? await seal(tokens.refresh_token) : c.refresh_token, Date.now() + (tokens.expires_in ?? 3600) * 1000, settingsId, c.generation, c.lease).run();
  if (!result.meta.changes) throw new Error("Conexiunea OneDrive s-a schimbat. Reîncearcă.");
  return tokens.access_token!;
}
type OneDriveActivity = "Instalare" | "Intervenție" | "Survey";
const oneDriveActivityFolders: Record<OneDriveActivity, string> = {
  Instalare: "Instalări",
  "Intervenție": "Intervenții",
  Survey: "Survey",
};
const oneDriveSectionFolders: Record<OneDriveActivity, Record<string, string>> = {
  Instalare: {
    project: "01_Documente proiect",
    safety: "02_Pretask și EIP",
    client: "03_Client",
    route: "04_Traseu FO",
    splices: "05_Suduri FO",
    site: "06_Operațiuni site",
    documents: "07_Documente administrative",
  },
  "Intervenție": {
    safety: "01_Pretask și EIP",
    "intervention-assessment": "02_Constatare",
    "intervention-execution": "03_Execuție",
    "intervention-documentation": "04_Documentare",
    project: "05_Documente intervenție",
    documents: "06_Documente administrative",
  },
  Survey: {
    safety: "01_Pretask și EIP",
    project: "02_Documente survey",
    documents: "03_Documente administrative",
  },
};
function readableFolderName(value: string) {
  return value.normalize("NFC").replace(/[\u0000-\u001f"*:<>?\/\\|#%]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 140) || "Lucrare";
}
async function oneDriveDestination(token: string, rootId: string, projectId: string, activity: OneDriveActivity, section: string) {
  const activityFolder = await folder(token, rootId, oneDriveActivityFolders[activity]);
  const projectFolder = await folder(token, activityFolder.id, readableFolderName(projectId));
  const sectionName = oneDriveSectionFolders[activity][section] ?? "99_Alte documente";
  return folder(token, projectFolder.id, sectionName);
}
async function uploadAcceptanceReport(token: string, projectId: string, destinationId: string) {
  const saved = await getRawDb().prepare("SELECT content_json FROM project_reports WHERE project_id = ? LIMIT 1").bind(projectId).first<{ content_json: string }>();
  if (!saved) return;
  let report: Record<string, string>;
  try { report = JSON.parse(saved.content_json); } catch { return; }
  const document = buildAcceptanceReportDocx(projectId, report);
  const filename = `Raport acceptanță - ${readableFolderName(projectId)}.docx`;
  await checked(await graph(token, `/me/drive/items/${encodeURIComponent(destinationId)}:/${encodeURIComponent(filename)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    body: document,
  }));
}

async function uploadSpliceSheet(token: string, projectId: string, destinationId: string) {
  const row = await getRawDb().prepare(
    "SELECT projects.client, projects.address, project_field_documentation.content_json AS documentation_json, project_reports.content_json AS report_json FROM projects LEFT JOIN project_field_documentation ON project_field_documentation.project_id = projects.id LEFT JOIN project_reports ON project_reports.project_id = projects.id WHERE projects.id = ? LIMIT 1"
  ).bind(projectId).first<{ client: string; address: string; documentation_json?: string; report_json?: string }>();
  if (!row?.documentation_json) return;

  let documentation: { splices?: { noIntervention?: boolean; noInterventionReason?: string; count?: number; records?: Array<{ junction?: { code?: string; name?: string; documented?: boolean; lat?: number; lon?: number }; junctionKind?: string; network?: string; siteCableType?: string; clientCableType?: string; siteBuffer?: string; siteFiber?: string; clientBuffer?: string; clientFiber?: string }> } };
  let report: { siteCode?: string; lec?: string } = {};
  try {
    documentation = JSON.parse(row.documentation_json);
    if (row.report_json) report = JSON.parse(row.report_json);
  } catch {
    return;
  }
  if (!documentation.splices) return;

  const splices = documentation.splices;
  const workbook = buildSpliceSheetXlsx({
    projectId,
    client: row.client,
    address: row.address,
    siteCode: report.siteCode,
    lec: report.lec,
    count: splices.count ?? splices.records?.length ?? 0,
    noIntervention: splices.noIntervention,
    noInterventionReason: splices.noInterventionReason,
    records: splices.records ?? [],
  });
  const baseName = `Fișa de suduri - ${readableFolderName(projectId)}`;
  const legacy = await graph(token, `/me/drive/items/${encodeURIComponent(destinationId)}:/${encodeURIComponent(`${baseName}.csv`)}`, { method: "DELETE" });
  if (!legacy.ok && legacy.status !== 404) throw new RemoteFailure(`OneDrive: fișierul CSV anterior nu a putut fi înlocuit (HTTP ${legacy.status}).`);
  const filename = `${baseName}.xlsx`;
  await checked(await graph(token, `/me/drive/items/${encodeURIComponent(destinationId)}:/${encodeURIComponent(filename)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    body: workbook,
  }));
}

async function uploadJob(c: Connection, job: Job) {
  const token = await tokenFor(c);
  if (job.kind === "project") {
    const project = await getRawDb().prepare("SELECT activity_type FROM projects WHERE id = ?").bind(job.item_id).first<{ activity_type?: OneDriveActivity }>();
    if (!project) return;
    const activity: OneDriveActivity = project.activity_type && project.activity_type in oneDriveActivityFolders ? project.activity_type : "Instalare";
    const activityFolder = await folder(token, c.root_id, oneDriveActivityFolders[activity]);
    const projectFolder = await folder(token, activityFolder.id, readableFolderName(job.item_id));
    const sections = await Promise.all(Object.entries(oneDriveSectionFolders[activity]).map(async ([section, name]) => ({
      section,
      item: await folder(token, projectFolder.id, name),
    })));
    const administrative = sections.find(({ section }) => section === "documents");
    if (administrative) {
      await uploadAcceptanceReport(token, job.item_id, administrative.item.id);
      await uploadSpliceSheet(token, job.item_id, administrative.item.id);
    }
    return;
  }
  const file = await getFileRow(job.item_id);
  if (!file) return;
  const projectId = file.project_id;
  let activity: OneDriveActivity = "Instalare";
  const project = await getRawDb().prepare("SELECT activity_type FROM projects WHERE id = ?").bind(projectId).first<{ activity_type?: OneDriveActivity }>();
  if (!project) return;
  if (project.activity_type && project.activity_type in oneDriveActivityFolders) activity = project.activity_type;
  const stored = await bucket().get(file.storage_key);
  if (!stored) throw new Error("Fișierul sursă nu mai este disponibil în Cloudflare.");
  const filename = await safeName(file.original_name, file.id);
  const body = await new Response(stored.body).arrayBuffer();
  const destination = await oneDriveDestination(token, c.root_id, projectId, activity, file.section);
  // Recheck before external write; switching/disconnecting does not resurrect old credentials.
  const current = await connection();
  if (!current || current.generation !== c.generation || current.lease !== c.lease || !usesOneDrive(current.mode)) throw new Error("Sincronizarea OneDrive a fost oprită.");
  await checked(await graph(token, `/me/drive/items/${encodeURIComponent(destination.id)}:/${encodeURIComponent(filename)}:/content`, { method: "PUT", headers: { "Content-Type": file.content_type }, body }));
}
export async function deleteOneDriveFileCopy(fileId: string) {
  if (!oneDriveConfigured()) return;
  const c = await connection();
  if (!c?.refresh_token) return;
  const file = await getFileRow(fileId);
  if (!file) return;
  const project = await getRawDb().prepare("SELECT activity_type FROM projects WHERE id = ?").bind(file.project_id).first<{ activity_type?: OneDriveActivity }>();
  if (!project) return;
  const activity: OneDriveActivity = project.activity_type && project.activity_type in oneDriveActivityFolders ? project.activity_type : "Instalare";
  const token = await tokenFor(c);
  const destination = await oneDriveDestination(token, c.root_id, file.project_id, activity, file.section);
  const filename = await safeName(file.original_name, file.id);
  const response = await graph(token, `/me/drive/items/${encodeURIComponent(destination.id)}:/${encodeURIComponent(filename)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`OneDrive nu a putut șterge copia fișierului (${response.status}).`);
  await getRawDb().prepare("DELETE FROM onedrive_jobs WHERE id = ?").bind(`file:${fileId}`).run();
}

export async function drainOneDrive() {
  if (!oneDriveConfigured()) return;
  const lease = crypto.randomUUID();
  const c = await getRawDb().prepare("UPDATE onedrive_connection SET lease = ?, lease_until = ? WHERE id = ? AND mode IN ('onedrive', 'both') AND refresh_token != '' AND lease_until < ? RETURNING *")
    .bind(lease, Date.now() + 120_000, settingsId, Date.now()).first<Connection>();
  if (!c) return;
  try {
    const job = await getRawDb().prepare("SELECT * FROM onedrive_jobs WHERE revision > done_revision AND next_at <= ? ORDER BY next_at, id LIMIT 1").bind(Date.now()).first<Job>();
    if (!job) return;
    try {
      await uploadJob(c, job);
      await getRawDb().prepare("UPDATE onedrive_jobs SET done_revision = ?, attempts = 0, last_error = '', next_at = 0 WHERE id = ? AND EXISTS (SELECT 1 FROM onedrive_connection WHERE generation = ? AND lease = ?)").bind(job.revision, job.id, c.generation, lease).run();
    } catch (error) {
      const message = error instanceof RemoteFailure ? error.message : "Sincronizarea nu a reușit. Verifică conexiunea și fișierul sursă, apoi reîncearcă.";
      const delay = Math.max(retryDelay(job.attempts), error instanceof RemoteFailure ? error.delay : 0);
      await getRawDb().prepare("UPDATE onedrive_jobs SET attempts = attempts + 1, next_at = ?, last_error = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM onedrive_connection WHERE generation = ? AND lease = ?)").bind(Date.now() + delay, message, job.id, job.revision, c.generation, lease).run();
    }
  } finally {
    await getRawDb().prepare("UPDATE onedrive_connection SET lease = '', lease_until = 0 WHERE id = ? AND lease = ?").bind(settingsId, lease).run();
  }
}
