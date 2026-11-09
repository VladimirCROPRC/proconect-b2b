import type { ExcelCell, ExcelSheet } from "./excel-export";
import { localDate, type TechnicianReport } from "./technician-report";

export function technicianReportSheet(report: TechnicianReport): ExcelSheet {
  const rows: ExcelCell[][] = report.works.map(work => [work.id, work.activityType, work.client, work.address, { date: localDate(work.createdAt) }, work.total,
    work.source === "orange-oroc" ? "Fără valori" : work.estimateStatus === "salvat" ? "Deviz salvat" : `Deviz ${work.estimateStatus}`, work.status, work.servicePackage ?? ""]);
  rows.push(["TOTAL FĂRĂ TVA", "", "", "", "", { formula: report.works.length ? `SUM(F5:F${report.works.length + 4})` : "0", value: report.total }, "", ""]);
  return { name: "Realizări tehnician", title: `Realizări · ${report.technician.name}`,
    subtitle: `${report.from} – ${report.to} · Toate statusurile. Orange/OROC fără valori. Perioadă după data creării lucrării/tichetului, Europe/Bucharest. ${report.missingEstimates} lucrări fără deviz valid; ${report.undated.length} lucrări fără dată de creare, neincluse.`,
    headers: ["Lucrare", "Tip", "Client", "Adresă", "Data creării", "Valoare deviz EUR fără TVA", "Situație deviz", "Status lucrare", "Pachet servicii"], widths: [20, 18, 30, 45, 20, 24, 22, 22, 24], rows, moneyColumns: [5] };
}
