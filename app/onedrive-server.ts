import { env } from "cloudflare:workers";
import { getRawDb } from "../db";
import { bucket, getFileRow } from "./project-server";
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
  const response = await fetch(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, { method: "POST", body: parameters, signal: AbortSignal.timeout(8000), redirect: "error" });
  if (!response.ok) throw new RemoteFailure("Microsoft a refuzat autorizarea. Reconectează contul; dacă se solicită aprobarea administratorului, contactează IT.");
  const tokens = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tokens.access_token) throw new RemoteFailure("Microsoft nu a returnat un token valid.");
  return tokens;
}
async function graph(token: string, path: string, options: RequestInit = {}) {
  if (!path.startsWith("/me/drive")) throw new Error("Adresă Graph nepermisă.");
  const headers = new Headers(options.headers); headers.set("Authorization", `Bearer ${token}`);
  return fetch(`https://graph.microsoft.com/v1.0${path}`, { ...options, headers, redirect: "error", signal: AbortSignal.timeout(8000) });
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
export async function finishOneDrive(sessionId: string, state: string, code: string) {
  const c = config();
  // DELETE RETURNING atomically consumes state, bound to the current app session.
  const authorization = await getRawDb().prepare("DELETE FROM onedrive_oauth_states WHERE id = ? AND session_id = ? AND expires_at > ? RETURNING verifier").bind(state, sessionId, Date.now()).first<{ verifier: string }>();
  if (!authorization) throw new Error("Autorizarea a expirat sau a fost deja folosită. Reîncearcă din aplicație.");
  const tokens = await exchange(new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: await unseal(authorization.verifier), redirect_uri: `${c.origin}/api/onedrive/callback`, scope }));
  if (!tokens.refresh_token) throw new Error("Microsoft nu a acordat acces pentru sincronizarea în fundal.");
  const drive = await checked(await graph(tokens.access_token!, "/me/drive"));
  if (drive.driveType !== "business" || !drive.id) throw new Error("Conectează contul OneDrive de serviciu Microsoft 365.");
  const existing = await connection();
  if (existing?.drive_id && existing.drive_id !== drive.id) throw new Error("Este conectat alt OneDrive. Deconectează-l explicit înainte de schimbarea contului.");
  const root = await checked(await graph(tokens.access_token!, "/me/drive/root"));
  const destination = await folder(tokens.access_token!, root.id, "Proconect B2B");
  const generation = crypto.randomUUID();
  await getRawDb().prepare("INSERT INTO onedrive_connection (id, mode, generation, access_token, refresh_token, expires_at, drive_id, root_id, root_url, account, owner_id, lease, lease_until) VALUES (?, 'google', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0) ON CONFLICT(id) DO UPDATE SET generation = excluded.generation, access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, drive_id = excluded.drive_id, root_id = excluded.root_id, root_url = excluded.root_url, account = excluded.account, owner_id = excluded.owner_id, lease = '', lease_until = 0")
    .bind(settingsId, generation, await seal(tokens.access_token!), await seal(tokens.refresh_token), Date.now() + (tokens.expires_in ?? 3600) * 1000, drive.id, destination.id, destination.webUrl ?? "", drive.owner?.user?.email ?? drive.owner?.user?.displayName ?? "OneDrive Microsoft 365", drive.owner?.user?.id ?? "").run();
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
  await getRawDb().prepare("UPDATE onedrive_jobs SET next_at = 0 WHERE revision > done_revision").run();
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
async function uploadJob(c: Connection, job: Job) {
  const token = await tokenFor(c);
  let projectId = job.item_id, filename: string, body: BodyInit, contentType = "application/json";
  if (job.kind === "file") {
    const file = await getFileRow(job.item_id);
    if (!file) return;
    projectId = file.project_id;
    const stored = await bucket().get(file.storage_key);
    if (!stored) throw new Error("Fișierul sursă nu mai este disponibil în Cloudflare.");
    filename = await safeName(`${file.section}--${file.original_name}`, file.id);
    body = await new Response(stored.body).arrayBuffer(); contentType = file.content_type;
  } else {
    const project = await getRawDb().prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first();
    if (!project) return;
    const documentation = await getRawDb().prepare("SELECT * FROM project_field_documentation WHERE project_id = ?").bind(projectId).first();
    const report = await getRawDb().prepare("SELECT * FROM project_reports WHERE project_id = ?").bind(projectId).first();
    const files = await getRawDb().prepare("SELECT id, section, category, original_name, geolocation, captured_at, uploaded_by FROM project_files WHERE project_id = ?").bind(projectId).all();
    filename = "Date_lucrare.json";
    body = JSON.stringify({ format: "proconect-project-v1", exportedAt: new Date().toISOString(), project, documentation, report, files: files.results }, null, 2);
  }
  const destination = await folder(token, c.root_id, await safeName(projectId, projectId));
  // Recheck before external write; switching/disconnecting does not resurrect old credentials.
  const current = await connection();
  if (!current || current.generation !== c.generation || current.lease !== c.lease || !usesOneDrive(current.mode)) throw new Error("Sincronizarea OneDrive a fost oprită.");
  await checked(await graph(token, `/me/drive/items/${encodeURIComponent(destination.id)}:/${encodeURIComponent(filename)}:/content`, { method: "PUT", headers: { "Content-Type": contentType }, body }));
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
