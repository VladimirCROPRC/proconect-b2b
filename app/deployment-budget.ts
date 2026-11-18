import { deploymentCatalog } from "./deployment-catalog";
import { boqCatalog } from "./boq-catalog";
import { buildBudgetSuggestions, type BudgetSuggestion } from "./project-budget";
import type { ProjectFieldDocumentation } from "./field-documentation";

const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export function deploymentSuggestion(id: string, position: number | undefined, quantity: number, evidence: string, name = "Alege poziția BoQ ND FO", night = false): BudgetSuggestion {
  const item = deploymentCatalog.find(item => item.row === position);
  return { id, catalog: "deployment-nd", category: "Manoperă", catalogPosition: item ? String(item.row) : "",
    name: item ? `${item.code} · ${item.nameRo || item.name}` : name,
    unit: item?.unit ?? "", unitPrice: item?.unitPrice == null ? 0 : item.unitPrice * (night ? 1.25 : 1),
    quantity, evidence, selected: true, night };
}

function fromInstallation(row: BudgetSuggestion) {
  const source = boqCatalog.find(item => String(item.row) === row.catalogPosition);
  const match = row.id === "site-patch" || row.id === "site-a-patch" ? deploymentCatalog.find(item => item.row === 143)
    : source ? deploymentCatalog.find(item => nameKey(item.name) === nameKey(source.name)) : undefined;
  return { ...deploymentSuggestion(row.id, match?.row, row.quantity, match ? row.evidence.replace(/rândul \d+/g, `poziția ${match.code}`) : row.evidence, row.name), note: row.note };
}

export function buildDeploymentBudget(data: ProjectFieldDocumentation) {
  return buildBudgetSuggestions(data).map(fromInstallation);
}

export function normalizeDeploymentBudget(value: unknown): BudgetSuggestion[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 1000) return null;
  const ids = new Set<string>();
  const nights = new Map<string, boolean>();
  const result: BudgetSuggestion[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || row.catalog !== "deployment-nd" || typeof row.id !== "string" || !row.id || row.id.length > 250 || ids.has(row.id)
      || typeof row.evidence !== "string" || row.evidence.length > 4000 || typeof row.quantity !== "number" || !Number.isFinite(row.quantity) || row.quantity <= 0
      || (row.note !== undefined && (typeof row.note !== "string" || row.note.length > 2000)) || (row.night !== undefined && typeof row.night !== "boolean")) return null;
    ids.add(row.id);
    if (row.catalogPosition === "included" && row.note?.trim()) {
      result.push({ ...deploymentSuggestion(row.id, undefined, row.quantity, row.evidence), catalogPosition: "included", name: "Inclus / furnizat de beneficiar", unit: "buc", note: row.note });
      continue;
    }
    const item = deploymentCatalog.find(item => String(item.row) === row.catalogPosition);
    if (!item || item.unitPrice === null) return null;
    const night = row.night === true;
    if (nights.has(row.catalogPosition) && nights.get(row.catalogPosition) !== night) return null;
    nights.set(row.catalogPosition, night);
    result.push({ ...deploymentSuggestion(row.id, item.row, row.quantity, row.evidence, undefined, night), note: row.note });
  }
  return result;
}

export function deploymentBudgetReady(rows: BudgetSuggestion[]) { return normalizeDeploymentBudget(rows) !== null; }

export function reconcileDeploymentBudget(generated: BudgetSuggestion[], saved: BudgetSuggestion[]) {
  const previous = new Map(saved.map(row => [row.id, row]));
  return [...generated.map(row => {
    const old = previous.get(row.id);
    if (!old) return row;
    const converted = old.catalog === "deployment-nd" ? old : fromInstallation(old);
    const quantity = old.evidence === row.evidence ? old.quantity : row.quantity || old.quantity;
    if (converted.catalogPosition === "included") return { ...row, catalogPosition: "included", unitPrice: 0, unit: "buc", quantity, note: old.note };
    return { ...deploymentSuggestion(row.id, Number(converted.catalogPosition), quantity, row.evidence, row.name, converted.night), note: old.note };
  }), ...saved.filter(row => row.id.startsWith("manual-")).map(row => row.catalog === "deployment-nd" ? row : fromInstallation(row))];
}
