import type { ExcelCell, ExcelSheet } from "./excel-export";
import type { DailyLine, DailyReport } from "./daily-technician-report";

function groupedRows(lines: DailyLine[], technician: string) {
  const groups = new Map<string, DailyLine[]>();
  for (const line of lines) {
    if (!line.date) continue;
    const group = groups.get(line.workId) ?? [];
    group.push(line); groups.set(line.workId, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([workId, group]): ExcelCell[] => {
    const dates = [...new Set(group.map(line => line.date!))].sort();
    const dated = group, all = group;
    const priced = dated.filter(line => line.total !== null);
    const total = priced.length ? priced.reduce((sum, line) => sum + Math.round(line.total! * 100), 0) / 100 : null;
    const notes = [...new Set(dated.map(line => line.note))];
    if (dated.some(line => line.total === null)) notes.push("Valoare parțială / tarife neconfirmate");
    const label = (line: DailyLine) => `${line.date ?? "Fără dată"} · ${line.code || "BoQ de completat"} · ${line.name}`;
    return [dates.length === 1 ? { date: dates[0] } : dates.join("\n"), technician, workId, all[0].client,
      all.map(label).join("\n"), all.map(line => `${line.date ?? "Fără dată"} · ${line.quantity === null ? "De completat" : line.quantity} ${line.unit}`).join("\n"), total, notes.join("\n")];
  });
}

export function dailyReportSheets(report: DailyReport): ExcelSheet[] {
  const lines = report.days.flatMap(day => day.lines);
  const field = lines.filter(line => line.source === "Teren"), orange = lines.filter(line => line.source === "Orange/OROC");
  const fieldRows = groupedRows(field, report.technician.name);
  const orangeRows = groupedRows(orange, report.technician.name);
  const total = (rows: ExcelCell[][]) => rows.reduce((sum, row) => sum + Math.round((typeof row[6] === "number" ? row[6] : 0) * 100), 0) / 100;
  const fieldTotal = total(fieldRows), orangeTotal = total(orangeRows);
  const orangeTotalRow = orangeRows.length + 5;
  const sumFormula = (count: number) => count ? `SUM(G5:G${count + 4})` : "0";
  const fieldCount = fieldRows.length, orangeCount = orangeRows.length;
  const fieldTotalRow = fieldRows.length + 5;
  const summary = (label: string, formula: string, value: number): ExcelCell[] => [label, "", "", "", "", "", { formula, value }, "Valori disponibile, fără TVA"];
  fieldRows.push(summary("TOTAL LUCRĂRI TEREN", sumFormula(fieldRows.length), fieldTotal));
  fieldRows.push(summary("TOTAL ORANGE/OROC", `'Orange OROC'!G${orangeTotalRow}`, orangeTotal));
  fieldRows.push(summary("TOTAL GENERAL", `SUM(G${fieldTotalRow}:G${fieldTotalRow + 1})`, Math.round((fieldTotal + orangeTotal) * 100) / 100));
  orangeRows.push(summary("TOTAL ORANGE/OROC", sumFormula(orangeRows.length), orangeTotal));
  const subtitle = `${report.from} – ${report.to} · Europe/Bucharest. O linie/lucrare în perioada selectată. Datele și manoperele sunt păstrate în celule. Fără dată: exclus din total. Materiale excluse.`;
  const common = { subtitle, headers: ["Date execuție", "Tehnician", "Lucrare / Tichet", "Client", "Manopere / Pachet", "Cantități / UM", "Valoare EUR fără TVA", "Observații"], widths: [22, 25, 25, 30, 85, 40, 26, 75], moneyColumns: [6] };
  if (report.warnings.length) fieldRows[fieldRows.length - 1][7] = `Verificări: ${report.warnings.join("; ")}`;
  return [
    { ...common, name: "Raport zilnic", title: `Lucrări teren · ${report.technician.name}`, rows: fieldRows, dataRowCount: fieldCount },
    { ...common, name: "Orange OROC", title: `Orange/OROC · ${report.technician.name}`, rows: orangeRows, dataRowCount: orangeCount },
  ];
}
