import { boqCatalog } from "./boq-catalog";
import type { ProjectFieldDocumentation, RouteMethod } from "./field-documentation";

export type BudgetSuggestion = {
  id: string;
  category: "Manoperă" | "Material";
  catalogPosition: string;
  name: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  evidence: string;
  selected: boolean;
  note?: string;
};

export function catalogSuggestion(id: string, row: number | undefined, quantity: number, evidence: string, pendingName = "Alege poziția BoQ"): BudgetSuggestion {
  if (id === "site-patch" || row === 108 || row === 109) return patchcordSuggestion(id, quantity, evidence);
  const item = boqCatalog.find(item => item.row === row);
  return {
    id, category: item?.category ?? "Manoperă", catalogPosition: item ? String(item.row) : "",
    name: item?.name ?? pendingName, unit: item?.unit ?? "", unitPrice: item?.unitPrice ?? 0,
    quantity, evidence, selected: true,
  };
}

function patchcordSuggestion(id: string, quantity: number, evidence: string): BudgetSuggestion {
  const item = boqCatalog.find(item => item.row === 108)!;
  return { id, category: item.category, catalogPosition: "108", name: item.name,
    unit: item.unit, unitPrice: item.unitPrice, quantity, evidence, selected: true, note: "Instalare patchcord până la 5 metri." };
}

function isPatchcordRow(row: { id: string; catalogPosition: string; note?: string }) {
  return row.id === "site-patch" || ["108", "109"].includes(row.catalogPosition)
    || row.note === "Instalarea patchcordului nu se facturează.";
}

// Default approved by the user: cable diameter <= 10 mm (10 mm for duct bands).
const routeRows: Record<RouteMethod, number> = { aerial: 91, duct: 83, tray: 95, facade: 88 };

export function buildBudgetSuggestions(data: ProjectFieldDocumentation): BudgetSuggestion[] {
  const rows: BudgetSuggestion[] = [];
  const add = (id: string, row: number | undefined, qty: number, evidence: string, name?: string) => rows.push(catalogSuggestion(id, row, qty, evidence, name));
  const route = data.route?.noIntervention ? undefined : data.route;
  const splices = data.splices?.noIntervention ? undefined : data.splices;
  const client = data.client?.noIntervention ? undefined : data.client;
  const site = data.site?.noIntervention ? undefined : data.site;

  for (const [index, segment] of (route?.segments ?? []).entries()) {
    if (!(segment.lengthMeters > 0)) continue;
    add(`route-${index}-${segment.method}`, routeRows[segment.method], segment.lengthMeters,
      `${segment.label} · ${segment.cableType} · ${segment.lengthMeters} m. Diametru implicit ≤10 mm.`);
  }
  for (const [key, row] of Object.entries({ boat: 138, stainlessClamp: 139, hook: 140, armorod: 141 })) {
    const qty = route?.aerialMaterials[key as keyof NonNullable<typeof route>["aerialMaterials"]] ?? 0;
    if (qty > 0) add(`material-${key}`, row, qty, `${qty} bucăți declarate în teren.`);
  }

  // One closure operation per junction. Included splices are not charged again.
  const groups = new Map<string, { label: string; kind: string; count: number; clientCable?: boolean }>();
  if (splices?.records?.length) {
    const seenRecords = new Set<string>();
    for (const record of splices.records) {
      if (seenRecords.has(record.id)) continue;
      seenRecords.add(record.id);
      const key = record.junction.id || record.junction.code;
      const group = groups.get(key) ?? { label: record.junction.code || record.junction.name, kind: record.junctionKind, count: 0 };
      group.count++;
      groups.set(key, group);
    }
  } else if (splices?.count) {
    // Legacy totals cannot be distributed reliably across several junctions.
    add("legacy-splices", undefined, splices.count,
      `${splices.count} suduri salvate; distribuția pe joncțiuni trebuie verificată pentru a scădea sudurile incluse.`, "Suduri FO — verifică pachetul BoQ");
  }
  if (route?.junction) {
    const endpoint = route.endpoints?.b;
    const key = endpoint?.id || "route-new-junction";
    const matching = groups.get(key) ?? [...groups.values()].find(group => group.label === endpoint?.code || group.label === route.junction.label || group.label === route.junction.label.split(" · ")[0]);
    const clientCable = route.segments.some(segment => segment.lengthMeters > 0);
    if (matching) {
      if (route.junction.kind === "new") matching.kind = "new";
      matching.clientCable = clientCable;
    }
    else {
      groups.set(key, { label: endpoint?.code || route.junction.label, kind: route.junction.kind, count: 0, clientCable });
    }
  }
  for (const [key, group] of groups) {
    const isNew = group.kind === "new";
    add(`closure-${key}`, isNew ? 100 : group.clientCable ? 103 : 102, 1,
      `${group.label}: ${group.count} suduri. ${isNew ? "Pachetul include până la 12 suduri." : group.clientCable ? "Din această joncțiune se instalează cablu către client; rândul 103 include până la 4 suduri." : "Fără instalare de cablu nou către client din această joncțiune; rândul 102 include până la 4 suduri."}`);
    const additional = Math.max(0, group.count - (isNew ? 12 : 4));
    if (additional) add(`additional-splices-${key}`, 101, additional, `${group.label}: numai sudurile care depășesc pachetul inclus.`);
  }

  // Installation alone does not identify the supplied enclosure model. Keep the
  // material visible for confirmation or mark it as supplied by the beneficiary.
  for (const [key, group] of groups) {
    if (group.kind === "new") add(`box-${key}`, undefined, 1,
      `${group.label}: joncțiune nouă. Confirmă furnizarea și modelul cutiei (rândurile 142–146).`, "Cutie de joncțiune — confirmă modelul și furnizarea");
  }
  if (client) {
    const accessories = client.equipment.filter(item => /SFP|Media Converter/i.test(item));
    const cpes = client.equipment.filter(item => !/SFP|Media Converter|Terminal Box/i.test(item));
    if (cpes.length) add("client-cpe", 128, cpes.length, `Client: ${cpes.join(", ")}. Serviciu ${client.service}; include acceptanța operațională.`);
    if (accessories.length) add("client-optics", 132, accessories.length, `Client: ${accessories.join(", ")}.`);
    const boxes = client.equipment.filter(item => /Terminal Box/i.test(item));
    if (boxes.length) add("client-terminal-box", 110, boxes.length,
      "Terminal Box instalat la client; include până la 12 suduri/modul. Verifică să nu fie facturate și la aceeași joncțiune.");
  }
  if (site) rows.push(patchcordSuggestion("site-patch", 1,
    `Conexiune ODF ${site.odf}/${site.odfPort} → eTN ${site.etn}/${site.etnPort}. Instalare patchcord până la 5 metri, rândul 108.`));

  const seenActivities = new Set<string>();
  for (const activity of data.intervention?.execution?.activities ?? []) {
    if (seenActivities.has(activity.id)) continue;
    seenActivities.add(activity.id);
    const location = activity.junction?.code ?? `${activity.endpointA?.code ?? "A"} → ${activity.endpointB?.code ?? "B"}`;
    const id = `intervention-${activity.id}`;
    if (activity.type === "fo-installation") add(id, undefined, activity.cableLengthMeters ?? 0,
      `${location} · ${activity.cableType ?? "FO"}. Diametru implicit ≤10 mm; confirmă modul de montaj (rândurile 83/88/91/95).`, "Instalare FO intervenție — alege montajul");
    else if (activity.type === "junction-installation") {
      add(id, 100, 1, `${location}: instalare joncțiune, include până la 12 suduri.`);
      add(`${id}-box`, undefined, 1, `${location}: confirmă modelul și furnizarea cutiei (142–146).`, "Cutie joncțiune intervenție — confirmă modelul");
    } else if (activity.type === "diagnostics") add(id, 111, 0,
      `${location}: diagnostic OTDR. Completează numărul de fibre măsurate; folosește rândul 112 pentru fibrele suplimentare.`, "Diagnostic OTDR");
    else add(id, undefined, 0,
      `${location}: remediere suduri. Completează numărul și pachetul aplicabil, scăzând sudurile incluse în alte operațiuni.`, "Remediere suduri — completează cantitatea și pachetul");
  }
  return rows;
}

export function budgetReady(rows: BudgetSuggestion[]) {
  return rows.length > 0 && rows.every(row => row.selected && (boqCatalog.some(item => String(item.row) === row.catalogPosition) || (row.catalogPosition === "included" && Boolean(row.note?.trim())))
    && Number.isFinite(row.quantity) && row.quantity > 0);
}

export function applyBudgetRules(rows: BudgetSuggestion[], generated: BudgetSuggestion[]) {
  const source = new Map(generated.map(row => [row.id, row]));
  return rows.map(row => {
    if (isPatchcordRow(row)) return patchcordSuggestion(row.id, row.quantity, row.evidence);
    const expected = source.get(row.id);
    if (expected?.id.startsWith("closure-") && ["102", "103"].includes(expected.catalogPosition) && row.catalogPosition !== "included") {
      return { ...catalogSuggestion(row.id, Number(expected.catalogPosition), row.quantity, expected.evidence), note: row.note };
    }
    return row;
  });
}

export function reconcileBudget(generated: BudgetSuggestion[], saved: BudgetSuggestion[]) {
  const previous = new Map(saved.map(row => [row.id, row]));
  return [...generated.map(row => {
    const old = previous.get(row.id);
    // Refresh source quantities/evidence. Preserve tariff choices; unknown quantities
    // (diagnostics, legacy repairs) retain the administrator's explicit input.
    if (!old) return row;
    if (row.id === "site-patch") return patchcordSuggestion(row.id, old.quantity, row.evidence);
    // Apply corrected 102/103 defaults to existing estimates as well.
    if (row.id.startsWith("closure-") && ["102", "103"].includes(row.catalogPosition) && old.catalogPosition !== "included") return { ...row, note: old.note };
    const chosen = boqCatalog.find(item => String(item.row) === old.catalogPosition);
    const quantity = old.evidence === row.evidence ? old.quantity : row.quantity || old.quantity;
    if (old.catalogPosition === "included") return { ...row, catalogPosition: "included", unit: "buc", quantity, unitPrice: 0, note: old.note };
    return chosen ? { ...catalogSuggestion(row.id, chosen.row, quantity, row.evidence), note: old.note } : row;
  }), ...saved.filter(row => row.id.startsWith("manual-")).map(row => isPatchcordRow(row) ? patchcordSuggestion(row.id, row.quantity, row.evidence) : row)];
}

export function normalizeBudget(value: unknown): BudgetSuggestion[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 1000) return null;
  const rows: BudgetSuggestion[] = [];
  const ids = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id || row.id.length > 250 || ids.has(row.id)
      || typeof row.evidence !== "string" || row.evidence.length > 4000
      || (row.note !== undefined && (typeof row.note !== "string" || row.note.length > 2000))
      || typeof row.quantity !== "number" || !Number.isFinite(row.quantity) || row.quantity <= 0) return null;
    const item = boqCatalog.find(item => String(item.row) === row.catalogPosition);
    if (!item && !(row.catalogPosition === "included" && row.note?.trim())) return null;
    ids.add(row.id);
    if (isPatchcordRow(row)) {
      rows.push(patchcordSuggestion(row.id, row.quantity, row.evidence));
      continue;
    }
    rows.push(item ? { ...catalogSuggestion(row.id, item.row, row.quantity, row.evidence), note: row.note } : {
      id: row.id, category: "Manoperă", catalogPosition: "included", name: "Inclus în altă poziție / furnizat de beneficiar",
      unit: "buc", unitPrice: 0, quantity: row.quantity, evidence: row.evidence, selected: true, note: row.note,
    });
  }
  return rows;
}
