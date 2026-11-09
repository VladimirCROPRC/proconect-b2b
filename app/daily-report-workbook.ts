import type { ExcelCell, ExcelSheet } from "./excel-export";
import type { DailyLine, DailyReport } from "./daily-technician-report";

export function dailyReportSheet(report: DailyReport): ExcelSheet {
  const rows: ExcelCell[][] = [];
  const detail = (line: DailyLine): ExcelCell[] => [line.date ? { date: line.date } : null, report.technician.name, line.source, line.workId, line.client, line.code, line.name, line.unit, line.quantity, line.unitPrice, line.total, line.note];
  for (const day of report.days) {
    const start = rows.length + 5;
    rows.push(...day.lines.map(detail));
    rows.push([{ date: day.date }, "TOTAL ZI", "", "", "", "", "", "", "", "", { formula: `SUM(K${start}:K${rows.length + 4})`, value: day.total }, `${day.unpriced} poziții fără valoare`]);
  }
  const totalRows = rows.map((row, index) => row[1] === "TOTAL ZI" ? `K${index + 5}` : null).filter(Boolean);
  rows.push(["TOTAL PERIOADĂ", "", "", "", "", "", "", "", "", "", { formula: totalRows.length ? totalRows.join("+") : "0", value: report.total }, "Valori disponibile, fără TVA"]);
  if (report.undated.length) {
    rows.push(["FĂRĂ DATĂ", "Neincluse în total / perioadă"]);
    // These amounts cannot be assigned to any day; keep them out of the numeric total column.
    rows.push(...report.undated.map(line => { const row = detail(line); row[10] = null; return row; }));
  }
  rows.push(...report.warnings.map(warning => ["VERIFICĂ", warning]));
  return { name: "Raport zilnic", title: `Raport zilnic · ${report.technician.name}`, subtitle: `${report.from} – ${report.to} · Europe/Bucharest. Teren: ultima fotografie a fiecărei manopere încărcată de tehnician; Orange/OROC: data execuției. Materialele sunt excluse.`,
    headers: ["Data execuției", "Tehnician", "Sursă", "Lucrare / Tichet", "Client", "BoQ / Pachet", "Manoperă / Serviciu", "UM", "Cantitate", "Tarif EUR fără TVA", "Valoare EUR fără TVA", "Observații"], widths: [20, 25, 20, 24, 30, 20, 65, 16, 16, 24, 24, 70], rows, numericColumns: [8], moneyColumns: [9, 10] };
}
