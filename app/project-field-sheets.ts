import type { ProjectFieldDocumentation, SpliceFieldSummary } from "./field-documentation";
import type { ExcelCell, ExcelSheet } from "./excel-export";

export type SheetProject = { id: string; client: string; address: string; splice?: string };
export type FieldSheet = { title: string; filename: string; project: SheetProject; headers: string[]; widths: number[]; rows: Array<Array<string | number>>; notes: string[]; numericColumns?: number[] };
type SavedSplice = NonNullable<SpliceFieldSummary["records"]>[number] & { spliceMode?: "fiber" | "end-to-end"; spliceCount?: number; siteCableType?: string; clientCableType?: string; connections?: Array<{ siteBuffer: string; siteFiber: string; clientBuffer: string; clientFiber: string }> };

export function spliceFieldSheet(project: SheetProject, data: ProjectFieldDocumentation): FieldSheet {
  const sheet: FieldSheet = { title: "Fișă de suduri", filename: `Fisa-suduri-${project.id}.xlsx`, project,
    headers: ["Nr.", "Joncțiune", "Nume", "Tip / Rețea", "Coordonate", "Cablu spre site", "Buffer / Fibră site", "Cablu spre client", "Buffer / Fibră client"], widths: [10, 20, 30, 26, 25, 25, 25, 25, 25], rows: [], notes: [] };
  if (data.splices?.noIntervention) {
    sheet.notes.push(`Nu s-a intervenit la sudurile FO. ${data.splices.noInterventionReason ?? ""}`);
    return sheet;
  }
  const seen = new Set<string>();
  for (const [index, record] of ((data.splices?.records ?? []) as SavedSplice[]).entries()) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    const kind = record.junction.documented ? "Documentată" : record.junctionKind === "new" ? "Nouă" : "Existentă";
    const network = record.network === "mobile" ? "Vodafone Mobil" : record.network === "fixed" ? "Vodafone Fixed" : "";
    const coordinates = Number.isFinite(record.junction.lat) && Number.isFinite(record.junction.lon) ? `${record.junction.lat.toFixed(6)}, ${record.junction.lon.toFixed(6)}` : "";
    const connections = record.connections?.length ? record.connections : [record];
    connections.forEach((connection, subIndex) => sheet.rows.push([
      connections.length > 1 ? `${index + 1}.${subIndex + 1}` : String(index + 1), record.junction.code || "Fără cod", record.junction.name,
      [kind, network, record.spliceMode === "end-to-end" ? `Cap–cap · ${record.spliceCount ?? 0} suduri` : ""].filter(Boolean).join(" / "), coordinates, record.siteCableType || "Nespecificat", [connection.siteBuffer, connection.siteFiber].filter(Boolean).join(" / "),
      record.clientCableType || "Nespecificat", [connection.clientBuffer, connection.clientFiber].filter(Boolean).join(" / "),
    ]));
  }
  if (sheet.rows.length) sheet.notes.push(`Total suduri: ${Math.max(sheet.rows.length, data.splices?.count ?? 0)}.`);
  else sheet.notes.push(data.splices?.count ? `${data.splices.count} suduri salvate ca total; corespondența fibrelor nu este disponibilă. Completează înregistrările din Suduri FO.` : "Nu există suduri salvate în teren.");
  if (project.splice) sheet.notes.push(`Diagramă de referință: ${project.splice}.`);
  return sheet;
}

export function materialFieldSheet(project: SheetProject, data: ProjectFieldDocumentation): FieldSheet {
  const sheet: FieldSheet = { title: "Fișă de materiale", filename: `Fisa-materiale-${project.id}.xlsx`, project,
    headers: ["Proprietar", "Material", "Cantitate", "UM"], widths: [22, 65, 20, 15], numericColumns: [2], rows: [], notes: [] };
  const materials = new Map<string, { owner: string; name: string; quantity: number; unit: string }>();
  const add = (owner: string, name: string, quantity: number, unit: string) => {
    if (!name.trim() || !Number.isFinite(quantity) || quantity <= 0) return;
    const key = JSON.stringify([owner, name.trim(), unit]);
    const item = materials.get(key) ?? { owner, name: name.trim(), quantity: 0, unit };
    item.quantity += quantity; materials.set(key, item);
  };
  const client = data.client as (NonNullable<ProjectFieldDocumentation["client"]> & { sfpType?: string; sfpQuantity?: number }) | undefined;
  if (client && !client.noIntervention) {
    const selectedOptics = Boolean(client.sfpType && client.equipment.some(equipment => /SFP/i.test(equipment)));
    for (const equipment of client.equipment) if (!(selectedOptics && /SFP/i.test(equipment))) add("Vodafone", equipment, 1, "buc.");
    if (selectedOptics) add("Vodafone", client.sfpType!, client.sfpQuantity ?? 1, "buc.");
  }
  if (data.client?.noIntervention) sheet.notes.push(`Client: nu s-a intervenit. ${data.client.noInterventionReason ?? ""}`);
  if (!data.client) sheet.notes.push("Echipamentele de la client nu au fost încă documentate în teren.");
  const route = data.route?.noIntervention ? undefined : data.route;
  for (const segment of route?.segments ?? []) add("Vodafone", segment.cableType, segment.lengthMeters, "m");
  const accessories = route?.aerialMaterials;
  for (const [key, name] of Object.entries({ boat: "Bărcuță", stainlessClamp: "Colier tablă inox", hook: "Cârlig", armorod: "Armorod" })) add("Proconect", name, accessories?.[key as keyof typeof accessories] ?? 0, "buc.");
  if (data.route?.noIntervention) sheet.notes.push(`Traseu FO: nu s-a intervenit. ${data.route.noInterventionReason ?? ""}`);
  // Preserve equipment selections in documentation saved by the earlier version.
  const site = data.site as (NonNullable<ProjectFieldDocumentation["site"]> & { mediaConverterInstalled?: boolean; mediaConverterType?: string; sfpInstalled?: boolean; sfpType?: string }) | undefined;
  if (site && !site.noIntervention) {
    if (site.mediaConverterInstalled && site.mediaConverterType) add("Vodafone", `Media Converter ${site.mediaConverterType} · site`, 1, "buc.");
    if (site.sfpInstalled && site.sfpType) add("Vodafone", `${site.sfpType} · site`, 1, "buc.");
  }
  sheet.rows = [...materials.values()].map(item => [item.owner, item.name, Math.round(item.quantity * 10000) / 10000, item.unit]);
  if (!sheet.rows.length) sheet.notes.push("Nu există materiale documentate în teren.");
  return sheet;
}

export function fieldSheetExcel(sheet: FieldSheet): ExcelSheet {
  const rows: ExcelCell[][] = sheet.rows.map(row => [sheet.project.id, sheet.project.client, sheet.project.address, ...row]);
  const dataRowCount = rows.length;
  rows.push(...sheet.notes.map(note => [sheet.project.id, sheet.project.client, sheet.project.address, "Notă", note]));
  return { name: sheet.title, title: `${sheet.title} · ${sheet.project.id}`, subtitle: "", headers: ["Proiect", "Client", "Adresă", ...sheet.headers], widths: [22, 32, 45, ...sheet.widths], rows, dataRowCount, numericColumns: sheet.numericColumns?.map(index => index + 3) };
}

const escapeHtml = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function fieldSheetPrintHtml(sheet: FieldSheet) {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>${escapeHtml(sheet.title)} · ${escapeHtml(sheet.project.id)}</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#143454}h1{font-size:22px}table{border-collapse:collapse;width:100%;margin-top:18px}th,td{border:1px solid #ccd5e2;padding:7px;text-align:left;overflow-wrap:anywhere}th{background:#e9eef6}thead{display:table-header-group}tr{break-inside:avoid}p{white-space:pre-wrap}small{color:#52647a}</style></head><body><h1>${escapeHtml(sheet.title)} · ${escapeHtml(sheet.project.id)}</h1><p><strong>Client:</strong> ${escapeHtml(sheet.project.client)}<br><strong>Adresă:</strong> ${escapeHtml(sheet.project.address)}</p><table><thead><tr>${sheet.headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${sheet.rows.map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>${sheet.notes.map(note => `<p>${escapeHtml(note)}</p>`).join("")}</body></html>`;
}
