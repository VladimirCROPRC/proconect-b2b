import { env } from "cloudflare:workers";
import { getRawDb } from "../db";
import { requiredInterventionCablePhotos, type InterventionExecutionActivity, type InterventionExecutionSummary, type InterventionJunction, type ProjectFieldDocumentation } from "./field-documentation";
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
const fileSections = new Set(["project", "client", "route", "splices", "site", "documents", "intervention-assessment", "intervention-execution"]);
const maximumUploadBytes = 20 * 1024 * 1024;

function validWorkIdentifier(value: string, activityType: ProjectActivityType) {
  return activityType === "Intervenție"
    ? /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(value)
    : /^RID\d{1,24}$/i.test(value);
}

export function hasValidPhotoCoordinates(value: string) {
  const coordinates = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:\s|$)/.exec(value.trim());
  if (!coordinates) return false;
  const latitude = Number(coordinates[1]);
  const longitude = Number(coordinates[2]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function validInterventionJunction(value: InterventionJunction | undefined) {
  if (!value || !Number.isFinite(value.lat) || !Number.isFinite(value.lon) || Math.abs(value.lat) > 90 || Math.abs(value.lon) > 180) return false;
  if (value.documented) return value.kind === "documented" && typeof value.code === "string" && Boolean(value.code.trim());
  return (value.kind === "existing" || value.kind === "new") && (value.network === "mobile" || value.network === "fixed");
}

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
  const activityType: ProjectActivityType = ["Instalare", "Intervenție", "Survey"].includes(input.activityType) ? input.activityType : "Instalare";
  const workId = typeof input.id === "string" ? input.id.trim().toUpperCase() : "";
  if (!validWorkIdentifier(workId, activityType)) {
    return {
      error: activityType === "Intervenție"
        ? "Numărul tichetului trebuie să conțină litere, cifre, punct, cratimă sau underscore."
        : "Request ID trebuie să conțină doar prefixul RID și cifre.",
      status: 400 as const,
    };
  }
  const required = [input.client, input.address, input.contact, input.phone, input.requirements, input.technician, ...(activityType === "Instalare" ? [input.cpe] : [])];
  if (required.some((value) => typeof value !== "string" || !value.trim())) {
    return { error: "Completează toate informațiile obligatorii ale proiectului.", status: 400 as const };
  }
  const existing = await getRawDb().prepare("SELECT id FROM projects WHERE id = ? LIMIT 1").bind(workId).first();
  if (existing) return { error: activityType === "Intervenție" ? "Numărul tichetului există deja. Verifică valoarea introdusă." : "Request ID există deja. Verifică numărul introdus.", status: 409 as const };

  const technician = await getRawDb()
    .prepare("SELECT username, name FROM app_users WHERE name = ? AND role = 'Tehnician' AND active = 1 LIMIT 1")
    .bind(input.technician)
    .first<{ username: string; name: string }>();
  if (!technician) return { error: "Tehnicianul selectat nu este disponibil.", status: 400 as const };

  const project: ProjectRecord = {
    ...input,
    id: workId,
    activityType,
    client: input.client.trim(),
    address: input.address.trim(),
    contact: input.contact.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    requirements: input.requirements.trim(),
    technician: technician.name,
    cpe: typeof input.cpe === "string" ? input.cpe.trim() : "",
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
  const activityType: ProjectActivityType = ["Instalare", "Intervenție", "Survey"].includes(input.activityType) ? input.activityType : "Instalare";
  if (!validWorkIdentifier(input.id, activityType)) {
    return { error: activityType === "Intervenție" ? "Numărul tichetului nu este valid." : "Request ID-ul proiectului nu este valid.", status: 400 as const };
  }
  const required = [input.client, input.address, input.contact, input.phone, input.requirements, input.technician, ...(activityType === "Instalare" ? [input.cpe] : [])];
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
    cpe: typeof input.cpe === "string" ? input.cpe.trim() : "",
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
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(projectId)) {
    return { error: "Identificatorul lucrării sau numărul tichetului nu este valid.", status: 400 as const };
  }

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
  if (!["client", "route", "splices", "site", "intervention"].includes(section)) {
    return { error: "Secțiunea de documentație nu este validă.", status: 400 as const };
  }
  const project = await getAuthorizedProject(projectId, account);
  if (!project) return { error: "Proiectul nu este disponibil pentru acest utilizator.", status: 404 as const };

  if (section === "intervention") {
    if (project.activity_type !== "Intervenție") {
      return { error: "Constatarea este disponibilă numai pentru intervenții.", status: 400 as const };
    }

    const intervention = content as { assessment?: { damageType?: unknown }; execution?: Partial<InterventionExecutionSummary> };
    const assessment = intervention?.assessment;
    if (!assessment || !["FO cut", "Atenuare", "Echipament"].includes(String(assessment.damageType))) {
      return { error: "Selectează tipul avariei înainte de salvarea constatării.", status: 400 as const };
    }

    const photos = await getRawDb()
      .prepare("SELECT geolocation FROM project_files WHERE project_id = ? AND section = ?")
      .bind(projectId, "intervention-assessment")
      .all<{ geolocation: string }>();

    if (!(photos.results ?? []).some((photo) => hasValidPhotoCoordinates(photo.geolocation))) {
      return { error: "Încarcă cel puțin o fotografie a avariei cu coordonate GPS valide.", status: 400 as const };
    }

    if (intervention.execution) {
      const execution = intervention.execution;
      if (!Array.isArray(execution.activities) || execution.activities.length < 1 || execution.activities.length > 100) {
        return { error: "Adaugă cel puțin o activitate validă pentru execuția intervenției.", status: 400 as const };
      }

      const executionPhotos = await getRawDb()
        .prepare("SELECT category, geolocation FROM project_files WHERE project_id = ? AND section = ?")
        .bind(projectId, "intervention-execution")
        .all<{ category: string; geolocation: string }>();
      const geotaggedExecutionPhotos = (executionPhotos.results ?? []).filter((photo) => hasValidPhotoCoordinates(photo.geolocation));
      const identifiers = new Set<string>();

      for (const item of execution.activities as InterventionExecutionActivity[]) {
        if (!item || typeof item.id !== "string" || !/^[a-f0-9-]{36}$/i.test(item.id) || identifiers.has(item.id)) {
          return { error: "Activitățile intervenției nu sunt identificate corect.", status: 400 as const };
        }
        identifiers.add(item.id);
        if (!["fo-installation", "junction-installation", "diagnostics", "splice-repair"].includes(item.type)) {
          return { error: "Tipul activității intervenției nu este valid.", status: 400 as const };
        }

        let requiredPhotos = 1;
        if (item.type === "fo-installation") {
          if (!validInterventionJunction(item.endpointA) || !validInterventionJunction(item.endpointB)) {
            return { error: "Completează ambele joncțiuni ale traseului FO și rețeaua punctelor nedocumentate.", status: 400 as const };
          }
          if (!Array.isArray(item.routePoints) || item.routePoints.length < 2 || item.routePoints.length > 500 || item.routePoints.some((point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lon))) {
            return { error: "Trasează cablul FO între cele două joncțiuni pe hartă.", status: 400 as const };
          }
          const cableType = typeof item.cableType === "string" ? item.cableType.trim() : "";
          const cableLength = typeof item.cableLengthMeters === "number" ? item.cableLengthMeters : 0;
          if (cableType.length < 2 || cableType.length > 120) {
            return { error: "Completează tipul cablului FO instalat.", status: 400 as const };
          }
          if (!Number.isFinite(cableLength) || cableLength <= 0 || cableLength > 1_000_000) {
            return { error: "Introdu o lungime validă pentru cablul FO instalat.", status: 400 as const };
          }
          requiredPhotos = requiredInterventionCablePhotos(cableLength);
        } else {
          if (!validInterventionJunction(item.junction)) {
            return { error: "Selectează sau plasează joncțiunea și completează rețeaua Vodafone.", status: 400 as const };
          }
          if (item.type === "junction-installation" && (item.junction?.documented || item.junction?.kind !== "new")) {
            return { error: "Joncțiunea nouă trebuie plasată pe hartă și asociată unei rețele Vodafone.", status: 400 as const };
          }
        }

        const activityPhotos = geotaggedExecutionPhotos.filter((photo) => photo.category === `${item.id}:photo`).length;
        if (activityPhotos < requiredPhotos) {
          return { error: item.type === "fo-installation"
            ? `Pentru ${item.cableLengthMeters} m sunt obligatorii ${requiredPhotos} fotografii GPS ale instalării FO.`
            : "Încarcă cel puțin o fotografie cu GPS din care să reiasă remedierea.", status: 400 as const };
        }
      }
    }
  }

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
