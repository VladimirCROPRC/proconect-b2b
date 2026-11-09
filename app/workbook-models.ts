import type { ExcelCell, ExcelSheet } from "./excel-export";
import type { BudgetSuggestion } from "./project-budget";
import { localDate, type TechnicianReport } from "./technician-report";

export function estimateSheet(project: { id: string; client: string; address: string }, items: BudgetSuggestion[]): ExcelSheet {
  const rows: ExcelCell[][] = items.map((item, index) => [project.id, item.catalogPosition, item.name, item.unit, item.quantity, item.unitPrice,
    { formula: `ROUND(E${index + 5}*F${index + 5},2)`, value: Math.round(item.quantity * item.unitPrice * 100) / 100 }, item.evidence, item.note ?? ""]);
  const total = items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPrice * 100), 0) / 100;
  rows.push(["TOTAL FĂRĂ TVA", "", "", "", "", "", { formula: items.length ? `SUM(G5:G${items.length + 4})` : "0", value: total }, "", ""]);
  return { name: "Deviz", title: `Deviz · ${project.id}`, subtitle: `${project.client} · ${project.address} · Valori în EUR fără TVA`,
    headers: ["Lucrare", "Rând BoQ", "Lucrare / material", "UM", "Cantitate", "Preț unitar EUR", "Total EUR fără TVA", "Documentare", "Observații"],
    widths: [20, 13, 58, 20, 14, 20, 23, 70, 55], rows, numericColumns: [4, 5], moneyColumns: [6] };
}

export function technicianReportSheet(report: TechnicianReport): ExcelSheet {
  const rows: ExcelCell[][] = report.works.map(work => [work.id, work.activityType, work.client, work.address, { date: localDate(work.completedAt) }, work.total,
    work.estimateStatus === "salvat" ? "Deviz salvat" : `Deviz ${work.estimateStatus}`]);
  rows.push(["TOTAL FĂRĂ TVA", "", "", "", "", { formula: report.works.length ? `SUM(F5:F${report.works.length + 4})` : "0", value: report.total }, ""]);
  return { name: "Realizări tehnician", title: `Realizări · ${report.technician.name}`,
    subtitle: `${report.from} – ${report.to} · Finalizare = ultima fotografie încărcată de tehnician, Europe/Bucharest. ${report.missingEstimates} lucrări fără deviz valid; ${report.undated.length} lucrări fără fotografii ale tehnicianului, neincluse.`,
    headers: ["Lucrare", "Tip", "Client", "Adresă", "Ultima fotografie / finalizare", "Valoare deviz EUR fără TVA", "Situație deviz"], widths: [20, 18, 30, 45, 20, 24, 22], rows, moneyColumns: [5] };
}
