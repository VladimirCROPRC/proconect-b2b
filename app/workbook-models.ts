import type { ExcelCell, ExcelSheet } from "./excel-export";
import { localDate, type TechnicianReport } from "./technician-report";

export function technicianReportSheet(report: TechnicianReport): ExcelSheet {
  const rows: ExcelCell[][] = report.works.map(work => [work.id, work.activityType, work.client, work.address, { date: localDate(work.createdAt) }, work.total,
    work.estimateStatus === "salvat" ? "Deviz salvat" : `Deviz ${work.estimateStatus}`]);
  rows.push(["TOTAL FĂRĂ TVA", "", "", "", "", { formula: report.works.length ? `SUM(F5:F${report.works.length + 4})` : "0", value: report.total }, ""]);
  return { name: "Realizări tehnician", title: `Realizări · ${report.technician.name}`,
    subtitle: `${report.from} – ${report.to} · Perioadă după data creării proiectului, Europe/Bucharest. ${report.missingEstimates} lucrări fără deviz valid; ${report.undated.length} lucrări fără dată de creare, neincluse.`,
    headers: ["Lucrare", "Tip", "Client", "Adresă", "Data creării", "Valoare deviz EUR fără TVA", "Situație deviz"], widths: [20, 18, 30, 45, 20, 24, 22], rows, moneyColumns: [5] };
}
