import { buildBudgetSuggestions, type BudgetSuggestion } from "./project-budget";
import type { ProjectFieldDocumentation } from "./field-documentation";
import { dayStart, localDate } from "./technician-report";

export type DailyProject = { id: string; client: string; assignedUsername?: string; documentation: string | null; estimate: string | null };
export type DailyPhoto = { projectId: string; section: string; category: string; uploadedBy: string; uploadedAt: number; capturedAt: number };
export type DailyTicket = { id: string; ticketNumber: string; workDate: string; packageCode: string; technicianUsername: string | null };
export type DailyLine = { key: string; workId: string; client: string; source: "Teren" | "Orange/OROC"; date: string | null; code: string; name: string; unit: string; quantity: number | null; unitPrice: number | null; total: number | null; note: string };
export type DailyReport = { technician: { username: string; name: string }; from: string; to: string; days: Array<{ date: string; lines: DailyLine[]; summary: Array<{ code: string; name: string; unit: string; quantity: number; incomplete: number }>; total: number; unpriced: number }>; undated: DailyLine[]; warnings: string[]; total: number };

function documentation(value: string | null): ProjectFieldDocumentation {
  const parsed = value ? JSON.parse(value) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Documentație invalidă");
  return parsed;
}

// Photos are linked to sections, splice records or individual intervention activities.
// Never assign a manual operation to an unrelated project photograph.
export function operationPhotos(row: BudgetSuggestion, data: ProjectFieldDocumentation, photos: DailyPhoto[]) {
  if (row.id.startsWith("intervention-")) return photos.filter(photo => photo.section === "intervention-execution" && row.id === `intervention-${photo.category.split(":")[0]}`);
  if (row.id.startsWith("route-")) return photos.filter(photo => photo.section === "route");
  if (row.id.startsWith("client-")) return photos.filter(photo => photo.section === "client");
  if (row.id === "site-patch") return photos.filter(photo => photo.section === "site");
  if (row.id.startsWith("closure-") || row.id.startsWith("additional-splices-") || row.id === "legacy-splices") {
    const junction = row.id.replace(/^(closure-|additional-splices-)/, "");
    const records = data.splices?.records?.filter(record => (record.junction.id || record.junction.code) === junction) ?? [];
    const ids = new Set(records.map(record => record.id));
    const routeJunction = data.route?.endpoints?.b.id ?? "route-new-junction";
    return photos.filter(photo => photo.section === "splices" && (row.id === "legacy-splices" || ids.has(photo.category.split(":")[0]))
      || records.length === 0 && photo.section === "route" && junction === routeJunction && row.id.startsWith("closure-"));
  }
  return [];
}

export function buildDailyReport(input: { technician: DailyReport["technician"]; from: string; to: string; projects: DailyProject[]; photos: DailyPhoto[]; tickets: DailyTicket[] }): DailyReport {
  const report: DailyReport = { technician: input.technician, from: input.from, to: input.to, days: [], undated: [], warnings: [], total: 0 };
  const lines: DailyLine[] = [];
  for (const project of input.projects) {
    try {
      const data = documentation(project.documentation);
      const rows: BudgetSuggestion[] = project.estimate ? JSON.parse(project.estimate) : buildBudgetSuggestions(data);
      if (!Array.isArray(rows)) throw new Error("Deviz invalid");
      const seen = new Set<string>();
      const projectLines: DailyLine[] = [];
      const projectUndated: DailyLine[] = [];
      for (const row of rows) {
        if (row.category !== "Manoperă" || row.id?.startsWith("box-") || row.id?.endsWith("-box")) continue;
        if ((row.id?.startsWith("route-") && data.route?.noIntervention)
          || ((row.id?.startsWith("closure-") || row.id?.startsWith("additional-splices-") || row.id === "legacy-splices") && (data.route?.noIntervention || !data.route?.junction) && data.splices?.noIntervention)
          || (row.id?.startsWith("client-") && data.client?.noIntervention)
          || (row.id === "site-patch" && data.site?.noIntervention)) continue;
        if (typeof row.id !== "string" || seen.has(row.id) || typeof row.name !== "string" || !Number.isFinite(row.quantity) || row.quantity < 0 || !Number.isFinite(row.unitPrice) || row.unitPrice < 0) throw new Error("Manoperă invalidă");
        seen.add(row.id);
        const photos = operationPhotos(row, data, input.photos.filter(photo => photo.projectId === project.id && photo.uploadedBy === input.technician.username));
        const last = photos.filter(photo => Number.isFinite(photo.uploadedAt) && photo.uploadedAt > 0).sort((a, b) => b.uploadedAt - a.uploadedAt || b.capturedAt - a.capturedAt)[0];
        const date = last ? localDate(last.capturedAt > 0 ? last.capturedAt : last.uploadedAt) : null;
        const quantity = row.quantity > 0 ? row.quantity : null;
        const priced = Boolean(project.estimate) && quantity !== null && row.selected !== false && Boolean(row.catalogPosition);
        const unitPrice = priced ? row.catalogPosition === "included" ? 0 : row.unitPrice : null;
        const line: DailyLine = { key: `project:${project.id}:${row.id}`, workId: project.id, client: project.client, source: "Teren", date, code: row.catalogPosition, name: row.name, unit: row.unit || "—", quantity, unitPrice,
          total: unitPrice === null || quantity === null ? null : Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100,
          note: [project.estimate ? "Deviz salvat" : "Din teren · deviz nesalvat", row.note, !date ? "Fără fotografie asociată a tehnicianului" : "Data ultimei fotografii a manoperei"].filter(Boolean).join(" · ") };
        if (!date && (project.assignedUsername === undefined || project.assignedUsername === input.technician.username)) projectUndated.push(line);
        else if (date && date >= input.from && date <= input.to) projectLines.push(line);
      }
      lines.push(...projectLines);
      report.undated.push(...projectUndated);
    } catch { report.warnings.push(`${project.id}: documentație sau deviz invalid; verifică lucrarea.`); }
  }
  for (const ticket of input.tickets) {
    if (ticket.technicianUsername !== input.technician.username || dayStart(ticket.workDate) === null || ticket.workDate < input.from || ticket.workDate > input.to) continue;
    const price = ticket.packageCode === "SP2 FOA" ? 300 : null;
    lines.push({ key: `orange:${ticket.id}`, workId: ticket.ticketNumber, client: "Orange/OROC", source: "Orange/OROC", date: ticket.workDate, code: ticket.packageCode, name: ticket.packageCode, unit: "tichet", quantity: 1, unitPrice: price, total: price, note: price === null ? "Tarif neconfigurat" : "Tarif pachet" });
  }
  for (const date of [...new Set(lines.map(line => line.date!))].sort()) {
    const dayLines = lines.filter(line => line.date === date).sort((a, b) => a.source.localeCompare(b.source) || a.workId.localeCompare(b.workId) || a.key.localeCompare(b.key));
    const groups = new Map<string, { code: string; name: string; unit: string; quantity: number; incomplete: number }>();
    for (const line of dayLines) {
      const key = JSON.stringify([line.source, line.code, line.name, line.unit]);
      const group = groups.get(key) ?? { code: line.code, name: line.name, unit: line.unit, quantity: 0, incomplete: 0 };
      group.quantity = Math.round((group.quantity + (line.quantity ?? 0)) * 10000) / 10000;
      if (line.quantity === null) group.incomplete++;
      groups.set(key, group);
    }
    const total = dayLines.reduce((sum, line) => sum + Math.round((line.total ?? 0) * 100), 0) / 100;
    report.days.push({ date, lines: dayLines, summary: [...groups.values()], total, unpriced: dayLines.filter(line => line.total === null).length });
  }
  report.total = report.days.reduce((sum, day) => sum + Math.round(day.total * 100), 0) / 100;
  return report;
}
