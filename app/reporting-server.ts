import { getRawDb } from "../db";
import { operationPhotos, type DailyPhoto } from "./daily-technician-report";
import type { ProjectFieldDocumentation } from "./field-documentation";
import type { BudgetSuggestion } from "./project-budget";
import { localDate } from "./technician-report";
import { reportingSheets, validReportingMonth, type ReportingEntry, type ReportingTechnician } from "./reporting-workbook";
import { createExcelWorkbook } from "./excel-export";

async function reportingData() {
  const db = getRawDb();
  // Keep former technicians in the historical report. Inactive accounts cannot
  // sign in, but their saved work must remain attributable.
  const technicians = await db.prepare("SELECT username,name FROM app_users WHERE role='Tehnician' ORDER BY name,username").all<ReportingTechnician>();
  const projects = await db.prepare(`SELECT p.id,p.technician_username,e.content_json AS estimate,d.content_json AS documentation
    FROM projects p JOIN project_estimates e ON e.project_id=p.id
    LEFT JOIN project_field_documentation d ON d.project_id=p.id
    WHERE p.activity_type='Instalare' ORDER BY p.id`).all<{
    id: string; technician_username: string; estimate: string; documentation: string | null;
  }>();
  const photos = await db.prepare(`SELECT f.project_id AS projectId,f.section,f.category,f.uploaded_by AS uploadedBy,
    f.created_at AS uploadedAt,f.captured_at AS capturedAt FROM project_files f
    JOIN app_users u ON u.username=f.uploaded_by WHERE u.role='Tehnician' ORDER BY f.created_at DESC`).all<DailyPhoto>();
  const tickets = await db.prepare(`SELECT ticket_number,work_date,service_package_code,technician_username
    FROM orange_oroc_tickets WHERE technician_username IS NOT NULL ORDER BY work_date,ticket_number`).all<{
    ticket_number: string; work_date: string; service_package_code: string; technician_username: string;
  }>();
  const users = technicians.results ?? [];
  const usernames = new Set(users.map(user => user.username));
  const entries: ReportingEntry[] = [];
  for (const project of projects.results ?? []) {
    if (!usernames.has(project.technician_username)) continue;
    const documentation: ProjectFieldDocumentation = project.documentation ? JSON.parse(project.documentation) : {};
    const rows = JSON.parse(project.estimate) as BudgetSuggestion[];
    if (!Array.isArray(rows)) throw new Error(`Deviz invalid pentru ${project.id}`);
    const ownPhotos = (photos.results ?? []).filter(photo => photo.projectId === project.id && photo.uploadedBy === project.technician_username);
    for (const row of rows) {
      if (row.category !== "Manoperă" || row.selected === false || row.catalogPosition === "included" || row.quantity === 0) continue;
      if (typeof row.name !== "string" || typeof row.catalogPosition !== "string" || !Number.isFinite(row.quantity) || row.quantity < 0 || !Number.isFinite(row.unitPrice) || row.unitPrice < 0) {
        throw new Error(`Poziție de deviz invalidă pentru ${project.id}`);
      }
      const matching = operationPhotos(row, documentation, ownPhotos);
      // Manual estimate rows have no individual photograph. Attribute them to
      // the last dated photograph of the same technician and work.
      const photo = (matching.length ? matching : ownPhotos)[0];
      if (!photo) continue;
      const timestamp = photo.capturedAt > 0 ? photo.capturedAt : photo.uploadedAt;
      if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
      entries.push({ username: project.technician_username, source: "Vodafone", workId: project.id,
        date: localDate(timestamp), code: row.catalogPosition, name: row.name, unit: row.unit,
        price: row.unitPrice, quantity: row.quantity });
    }
  }
  const { orangeServicePackages } = await import("./orange-services");
  for (const ticket of tickets.results ?? []) {
    if (!usernames.has(ticket.technician_username)) continue;
    const item = orangeServicePackages.find(item => item.code === ticket.service_package_code);
    entries.push({ username: ticket.technician_username, source: "Orange/OROC", workId: ticket.ticket_number,
      date: ticket.work_date, code: ticket.service_package_code, name: item?.label ?? ticket.service_package_code,
      unit: item?.unit ?? "intervention", price: ticket.service_package_code === "SP2 FOA" ? 300 : null, quantity: 1 });
  }
  return { users, entries };
}

export async function reportingMonths(now = Date.now()) {
  const { entries } = await reportingData();
  return [...new Set([localDate(now).slice(0, 7), ...entries.map(entry => entry.date.slice(0, 7))])]
    .filter(validReportingMonth).sort();
}

export async function buildReportingWorkbook(month = localDate(Date.now()).slice(0, 7)) {
  if (!validReportingMonth(month)) throw new Error("Lună invalidă. Folosește formatul AAAA-LL.");
  const { users, entries } = await reportingData();
  return createExcelWorkbook(reportingSheets(users, entries, month));
}
