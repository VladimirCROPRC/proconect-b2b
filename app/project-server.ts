import { env } from "cloudflare:workers";
import { getRawDb } from "../db";
import type { ProjectFieldDocumentation } from "./field-documentation";
import { initialCpeCatalog, initialFieldDocumentation, initialProjects, type ProjectActivityType, type ProjectRecord } from "./project-data";
import type { AuthenticatedAccount } from "./server-auth";

type ProjectRow = {
  id: string;
  activity_type: ProjectActivityType;
  client: string;
  address: string;
  contact: string;
  phone: string;
  email: string;
  requirements: string;
  technician: string;
  technician_username: string;
  cpe: string;
  sfp: number;
  mc: number;
  terminal_box: number;
  status: ProjectRecord["status"];
  scheduled_label: string;
  ipwo: string;
  splice: string;
};

type StoredFileRow = {
  id: string;
  project_id: string;
  section: string;
  category: string;
  original_name: string;
  content_type: string;
  byte_size: number;
  storage_key: string;
  geolocation: string;
  captured_at: number;
  uploaded_by: string;
  created_at: number;
};

type StorageEnvironment = {
  BUCKET?: {
    put(key: string, value: ReadableStream | ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
    get(key: string): Promise<{ body: ReadableStream; size: number; httpMetadata?: { contentType?: string } } | null>;
    delete(key: string): Promise<void>;
  };
};

const storageEnvironment = env as unknown as StorageEnvironment;
const fileSections = new Set(["project", "client", "route", "splices", "site", "documents"]);
const maximumUploadBytes = 20 * 1024 * 1024;

export function isManagementRole(account: AuthenticatedAccount) {
  return account.role === "Admin" || account.role === "Manager" || account.role === "Coordonator";
}

function projectRowToRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    activityType: row.activity_type,
    client: row.client,
    address: row.address,
    contact: row.contact,
    phone: row.phone,
    email: row.email,
    requirements: row.requirements,
    technician: row.technician,
    cpe: row.cpe,
    sfp: Boolean(row.sfp),
    mc: Boolean(row.mc),
    terminalBox: Boolean(row.terminal_box),
    status: row.status,
    date: row.scheduled_label,
    ipwo: row.ipwo,
    splice: row.splice,
  };
}

function insertProjectStatement(project: ProjectRecord, technicianUsername: string, createdBy: string, createdAt = Date.now()) {
  return getRawDb()
    .prepare(
      "INSERT INTO projects (id, activity_type, client, address, contact, phone, email, requirements, technician, technician_username, cpe, sfp, mc, terminal_box, status, scheduled_label, ipwo, splice, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      project.id,
      project.activityType,
      project.client,
      project.address,
      project.contact,
      project.phone,
      project.email,
      project.requirements,
      project.technician,
      technicianUsername,
      project.cpe,
      project.sfp ? 1 : 0,
      project.mc ? 1 : 0,
      project.terminalBox ? 1 : 0,
      project.status,
      project.date,
      project.ipwo,
      project.splice,
      createdBy,
      createdAt,
      createdAt,
    );
}

export async function ensureProjectData() {
  const [existingProjects, existingEquipment] = await Promise.all([
    getRawDb().prepare("SELECT COUNT(*) AS count FROM projects").first<{ count: number }>(),
    getRawDb().prepare("SELECT COUNT(*) AS count FROM cpe_catalog").first<{ count: number }>(),
  ]);
  if ((existingProjects?.count ?? 0) > 0 || (existingEquipment?.count ?? 0) > 0) return;

  const now = Date.now();
  const statements = initialProjects.map((project, index) => insertProjectStatement(project, "vlad", "vladimir.carlan", now - index));
  for (const [projectId, documentation] of Object.entries(initialFieldDocumentation)) {
    statements.push(
      getRawDb()
        .prepare("INSERT INTO project_field_documentation (project_id, content_json, updated_by, updated_at) VALUES (?, ?, ?, ?)")
        .bind(projectId, JSON.stringify(documentation), "vladimir.carlan", now),
    );
  }
  for (const name of initialCpeCatalog) {
    statements.push(getRawDb().prepare("INSERT OR IGNORE INTO cpe_catalog (id, name, created_at) VALUES (?, ?, ?)").bind(crypto.randomUUID(), name, now));
  }
  await getRawDb().batch(statements);
}

export async function listProjectData(account: AuthenticatedAccount) {
  const query = isManagementRole(account)
    ? getRawDb().prepare("SELECT * FROM projects ORDER BY created_at DESC")
    : getRawDb().prepare("SELECT * FROM projects WHERE technician_username = ? ORDER BY created_at DESC").bind(account.username);
  const result = await query.all<ProjectRow>();
  const projects = (result.results ?? []).map((row: ProjectRow) => projectRowToRecord(row));

  const documentationQuery = isManagementRole(account)
    ? getRawDb().prepare("SELECT project_field_documentation.project_id, project_field_documentation.content_json FROM project_field_documentation")
    : getRawDb()
        .prepare("SELECT project_field_documentation.project_id, project_field_documentation.content_json FROM project_field_documentation INNER JOIN projects ON projects.id = project_field_documentation.project_id WHERE projects.technician_username = ?")
        .bind(account.username);
  const documentationRows = await documentationQuery.all<{ project_id: string; content_json: string }>();
  const fieldDocumentation: Record<string, ProjectFieldDocumentation> = {};
  for (const row of documentationRows.results ?? []) {
    try {
      fieldDocumentation[row.project_id] = JSON.parse(row.content_json) as ProjectFieldDocumentation;
    } catch {
      fieldDocumentation[row.project_id] = {};
    }
  }

  const cpeRows = await getRawDb().prepare("SELECT name FROM cpe_catalog ORDER BY created_at ASC").all<{ name: string }>();
  const cpe = (cpeRows.results ?? []).map((row: { name: string }) => row.name);
  return { projects, fieldDocumentation, cpe };
}

export async function getAuthorizedProject(projectId: string, account: AuthenticatedAccount) {
  const query = isManagementRole(account)
    ? getRawDb().prepare("SELECT * FROM projects WHERE id = ? LIMIT 1").bind(projectId)
    : getRawDb().prepare("SELECT * FROM projects WHERE id = ? AND technician_username = ? LIMIT 1").bind(projectId, account.username);
  return query.first<ProjectRow>();
}

export async function createProject(input: ProjectRecord, createdBy: AuthenticatedAccount) {
  if (!/^RID\d{1,24}$/i.test(input.id)) return { error: "Request ID trebuie să conțină doar prefixul RID și cifre.", status: 400 as const };
  const required = [input.client, input.address, input.contact, input.phone, input.requirements, input.technician, input.cpe];
  if (required.some((value) => typeof value !== "string" || !value.trim())) {
    return { error: "Completează toate informațiile obligatorii ale proiectului.", status: 400 as const };
  }
  const existing = await getRawDb().prepare("SELECT id FROM projects WHERE id = ? LIMIT 1").bind(input.id).first();
  if (existing) return { error: "Request ID există deja. Verifică numărul introdus.", status: 409 as const };

  const technician = await getRawDb()
    .prepare("SELECT username, name FROM app_users WHERE name = ? AND role = 'Tehnician' AND active = 1 LIMIT 1")
    .bind(input.technician)
    .first<{ username: string; name: string }>();
  if (!technician) return { error: "Tehnicianul selectat nu este disponibil.", status: 400 as const };

  const project: ProjectRecord = {
    ...input,
    id: input.id.toUpperCase(),
    activityType: ["Instalare", "Intervenție", "Survey"].includes(input.activityType) ? input.activityType : "Instalare",
    client: input.client.trim(),
    address: input.address.trim(),
    contact: input.contact.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    requirements: input.requirements.trim(),
    technician: technician.name,
    cpe: input.cpe.trim(),
    status: "Planificat",
    date: input.date || "Astăzi",
    ipwo: input.ipwo || "Fișier neîncărcat",
    splice: input.splice || "Fișier neîncărcat",
  };
  await getRawDb().batch([
    insertProjectStatement(project, technician.username, createdBy.username),
    getRawDb().prepare("UPDATE app_users SET jobs = jobs + 1, updated_at = ? WHERE username = ?").bind(Date.now(), technician.username),
  ]);
  return { project };
}

export async function updateProject(input: ProjectRecord) {
  if (!/^RID\d{1,24}$/i.test(input.id)) return { error: "Request ID-ul proiectului nu este valid.", status: 400 as const };
  const required = [input.client, input.address, input.contact, input.phone, input.requirements, input.technician, input.cpe];
  if (required.some((value) => typeof value !== "string" || !value.trim())) {
    return { error: "Completează toate informațiile obligatorii ale proiectului.", status: 400 as const };
  }
  if (!["Planificat", "În desfășurare", "De verificat", "Finalizat"].includes(input.status)) {
    return { error: "Statusul proiectului nu este valid.", status: 400 as const };
  }

  const existing = await getRawDb().prepare("SELECT * FROM projects WHERE id = ? LIMIT 1").bind(input.id.toUpperCase()).first<ProjectRow>();
  if (!existing) return { error: "Proiectul selectat nu există.", status: 404 as const };

  const technician = await getRawDb()
    .prepare("SELECT username, name FROM app_users WHERE name = ? AND role = 'Tehnician' AND active = 1 LIMIT 1")
    .bind(input.technician.trim())
    .first<{ username: string; name: string }>();
  if (!technician) return { error: "Tehnicianul selectat nu este disponibil.", status: 400 as const };

  const project: ProjectRecord = {
    ...input,
    id: existing.id,
    activityType: ["Instalare", "Intervenție", "Survey"].includes(input.activityType) ? input.activityType : existing.activity_type,
    client: input.client.trim(),
    address: input.address.trim(),
    contact: input.contact.trim(),
    phone: input.phone.trim(),
    email: typeof input.email === "string" ? input.email.trim() : "",
    requirements: input.requirements.trim(),
    technician: technician.name,
    cpe: input.cpe.trim(),
    sfp: Boolean(input.sfp),
    mc: Boolean(input.mc),
    terminalBox: Boolean(input.terminalBox),
    date: typeof input.date === "string" && input.date.trim() ? input.date.trim() : existing.scheduled_label,
    ipwo: typeof input.ipwo === "string" && input.ipwo.trim() ? input.ipwo.trim() : existing.ipwo,
    splice: typeof input.splice === "string" && input.splice.trim() ? input.splice.trim() : existing.splice,
  };
  const now = Date.now();
  const statements = [
    getRawDb().prepare(
      "UPDATE projects SET activity_type = ?, client = ?, address = ?, contact = ?, phone = ?, email = ?, requirements = ?, technician = ?, technician_username = ?, cpe = ?, sfp = ?, mc = ?, terminal_box = ?, status = ?, scheduled_label = ?, ipwo = ?, splice = ?, updated_at = ? WHERE id = ?",
    ).bind(
      project.activityType,
      project.client,
      project.address,
      project.contact,
      project.phone,
      project.email,
      project.requirements,
      project.technician,
      technician.username,
      project.cpe,
      project.sfp ? 1 : 0,
      project.mc ? 1 : 0,
      project.terminalBox ? 1 : 0,
      project.status,
      project.date,
      project.ipwo,
      project.splice,
      now,
      project.id,
    ),
  ];

  if (existing.technician_username !== technician.username) {
    statements.push(
      getRawDb().prepare("UPDATE app_users SET jobs = CASE WHEN jobs > 0 THEN jobs - 1 ELSE 0 END, updated_at = ? WHERE username = ?").bind(now, existing.technician_username),
      getRawDb().prepare("UPDATE app_users SET jobs = jobs + 1, updated_at = ? WHERE username = ?").bind(now, technician.username),
    );
  }

  await getRawDb().batch(statements);
  return { project };
}

export async function deleteProject(projectId: string) {
  if (!/^RID\d{1,24}$/i.test(projectId)) return { error: "Request ID-ul proiectului nu este valid.", status: 400 as const };

  const project = await getRawDb()
    .prepare("SELECT id, technician_username FROM projects WHERE id = ? LIMIT 1")
    .bind(projectId.toUpperCase())
    .first<{ id: string; technician_username: string }>();
  if (!project) return { error: "Proiectul selectat nu există sau a fost deja șters.", status: 404 as const };

  const files = await getRawDb()
    .prepare("SELECT storage_key FROM project_files WHERE project_id = ?")
    .bind(project.id)
    .all<{ storage_key: string }>();
  const storageKeys = (files.results ?? []).map((file) => file.storage_key);

  await getRawDb().batch([
    getRawDb().prepare("DELETE FROM projects WHERE id = ?").bind(project.id),
    getRawDb()
      .prepare("UPDATE app_users SET jobs = CASE WHEN jobs > 0 THEN jobs - 1 ELSE 0 END, updated_at = ? WHERE username = ?")
      .bind(Date.now(), project.technician_username),
  ]);

  let cleanupFailures = 0;
  if (storageKeys.length) {
    try {
      const cleanup = await Promise.allSettled(storageKeys.map((key) => bucket().delete(key)));
      cleanupFailures = cleanup.filter((result) => result.status === "rejected").length;
    } catch {
      cleanupFailures = storageKeys.length;
    }
    if (cleanupFailures) console.error(`Proconect project cleanup: ${cleanupFailures} fișiere necesită curățare pentru ${project.id}.`);
  }

  return { projectId: project.id, cleanupFailures };
}

export async function saveFieldDocumentation(projectId: string, section: string, content: unknown, account: AuthenticatedAccount) {
  if (!["client", "route", "splices", "site"].includes(section)) {
    return { error: "Secțiunea de documentație nu este validă.", status: 400 as const };
  }
  const project = await getAuthorizedProject(projectId, account);
  if (!project) return { error: "Proiectul nu este disponibil pentru acest utilizator.", status: 404 as const };
  const serialized = JSON.stringify(content);
  if (!serialized || serialized.length > 600_000) return { error: "Documentația depășește dimensiunea permisă.", status: 400 as const };

  const existing = await getRawDb()
    .prepare("SELECT content_json FROM project_field_documentation WHERE project_id = ? LIMIT 1")
    .bind(projectId)
    .first<{ content_json: string }>();
  let current: ProjectFieldDocumentation = {};
  if (existing) {
    try {
      current = JSON.parse(existing.content_json) as ProjectFieldDocumentation;
    } catch {
      current = {};
    }
  }

  const next = { ...current, [section]: content };
  await getRawDb()
    .prepare(
      "INSERT INTO project_field_documentation (project_id, content_json, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET content_json = excluded.content_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
    )
    .bind(projectId, JSON.stringify(next), account.username, Date.now())
    .run();
  return { documentation: next };
}

export async function addCpe(name: string) {
  const normalized = name.trim();
  if (normalized.length < 2 || normalized.length > 120) return { error: "Denumirea echipamentului nu este validă.", status: 400 as const };
  const existing = await getRawDb().prepare("SELECT id FROM cpe_catalog WHERE name = ? LIMIT 1").bind(normalized).first();
  if (existing) return { error: "Echipamentul există deja în catalog.", status: 409 as const };
  await getRawDb().prepare("INSERT INTO cpe_catalog (id, name, created_at) VALUES (?, ?, ?)").bind(crypto.randomUUID(), normalized, Date.now()).run();
  return { name: normalized };
}

export async function renameCpe(previousName: string, name: string) {
  const originalName = previousName.trim();
  const normalized = name.trim();
  if (normalized.length < 2 || normalized.length > 120) return { error: "Denumirea echipamentului nu este validă.", status: 400 as const };

  const existing = await getRawDb().prepare("SELECT id, name FROM cpe_catalog WHERE name = ? LIMIT 1").bind(originalName).first<{ id: string; name: string }>();
  if (!existing) return { error: "Echipamentul selectat nu există în catalog.", status: 404 as const };
  if (existing.name === normalized) return { previousName: existing.name, name: normalized };

  const duplicate = await getRawDb().prepare("SELECT id FROM cpe_catalog WHERE name = ? AND id != ? LIMIT 1").bind(normalized, existing.id).first();
  if (duplicate) return { error: "Echipamentul există deja în catalog.", status: 409 as const };

  await getRawDb().batch([
    getRawDb().prepare("UPDATE cpe_catalog SET name = ? WHERE id = ?").bind(normalized, existing.id),
    getRawDb().prepare("UPDATE projects SET cpe = ?, updated_at = ? WHERE cpe = ?").bind(normalized, Date.now(), existing.name),
  ]);
  return { previousName: existing.name, name: normalized };
}

export function bucket() {
  if (!storageEnvironment.BUCKET) throw new Error("Stocarea securizată a fișierelor nu este disponibilă.");
  return storageEnvironment.BUCKET;
}

export function validateUpload(section: string, category: string, file: File) {
  if (!fileSections.has(section)) return "Secțiunea fișierului nu este validă.";
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(category)) return "Categoria fișierului nu este validă.";
  if (file.size <= 0 || file.size > maximumUploadBytes) return "Fișierul trebuie să aibă maximum 20 MB.";
  if (section !== "project" && section !== "documents" && !file.type.startsWith("image/")) {
    return "Această secțiune acceptă numai fotografii.";
  }
  return null;
}

function fileMetadata(row: StoredFileRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    section: row.section,
    category: row.category,
    name: row.original_name,
    contentType: row.content_type,
    size: row.byte_size,
    geo: row.geolocation,
    capturedAt: row.captured_at,
    uploadedBy: row.uploaded_by,
    url: `/api/files/${row.id}`,
  };
}

export async function storeFile(input: { projectId: string; section: string; category: string; file: File; geo: string; uploadedBy: string }) {
  const id = crypto.randomUUID();
  const safeName = input.file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
  const key = `${input.projectId}/${input.section}/${input.category}/${id}-${safeName || "fisier"}`;
  const contentType = input.file.type || "application/octet-stream";
  await bucket().put(key, input.file.stream(), {
    httpMetadata: { contentType },
    customMetadata: { projectId: input.projectId, section: input.section, category: input.category },
  });
  const now = Date.now();
  try {
    await getRawDb()
      .prepare(
        "INSERT INTO project_files (id, project_id, section, category, original_name, content_type, byte_size, storage_key, geolocation, captured_at, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(id, input.projectId, input.section, input.category, input.file.name, contentType, input.file.size, key, input.geo, now, input.uploadedBy, now)
      .run();
  } catch (error) {
    await bucket().delete(key);
    throw error;
  }

  return fileMetadata({
    id,
    project_id: input.projectId,
    section: input.section,
    category: input.category,
    original_name: input.file.name,
    content_type: contentType,
    byte_size: input.file.size,
    storage_key: key,
    geolocation: input.geo,
    captured_at: now,
    uploaded_by: input.uploadedBy,
    created_at: now,
  });
}

export async function listProjectFiles(projectId: string, section?: string) {
  const query = section
    ? getRawDb().prepare("SELECT * FROM project_files WHERE project_id = ? AND section = ? ORDER BY created_at ASC").bind(projectId, section)
    : getRawDb().prepare("SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at ASC").bind(projectId);
  const rows = await query.all<StoredFileRow>();
  return (rows.results ?? []).map((row: StoredFileRow) => fileMetadata(row));
}

export async function getFileRow(fileId: string) {
  return getRawDb().prepare("SELECT * FROM project_files WHERE id = ? LIMIT 1").bind(fileId).first<StoredFileRow>();
}

export async function removeFile(fileId: string) {
  const file = await getFileRow(fileId);
  if (!file) return false;
  await bucket().delete(file.storage_key);
  await getRawDb().prepare("DELETE FROM project_files WHERE id = ?").bind(fileId).run();
  return true;
}

export async function readReport(projectId: string) {
  const row = await getRawDb().prepare("SELECT content_json, updated_at FROM project_reports WHERE project_id = ? LIMIT 1").bind(projectId).first<{ content_json: string; updated_at: number }>();
  if (!row) return null;
  return { report: JSON.parse(row.content_json) as Record<string, string>, updatedAt: row.updated_at };
}

export async function writeReport(projectId: string, content: Record<string, string>, account: AuthenticatedAccount) {
  const serialized = JSON.stringify(content);
  if (serialized.length > 300_000) return { error: "Raportul depășește dimensiunea permisă.", status: 400 as const };
  const now = Date.now();
  await getRawDb()
    .prepare("INSERT INTO project_reports (project_id, content_json, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET content_json = excluded.content_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
    .bind(projectId, serialized, account.username, now)
    .run();
  return { report: content, updatedAt: now };
}
