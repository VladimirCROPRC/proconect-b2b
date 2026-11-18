import { boqCatalog } from "./boq-catalog";
import { orangeServicePackages } from "./orange-services";
import type { ExcelCell, ExcelSheet } from "./excel-export";

export type ReportingTechnician = { username: string; name: string };
export type ReportingEntry = {
  username: string;
  source: "Vodafone" | "Orange/OROC";
  workId: string;
  date: string;
  code: string;
  name: string;
  unit: string;
  price: number | null;
  quantity: number;
};
type Position = Pick<ReportingEntry, "source" | "code" | "name" | "unit" | "price">;

function positionKey(row: Position) {
  return JSON.stringify([row.source, row.code, row.name, row.unit, row.price]);
}

function column(index: number) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + (value - 1) % 26) + name;
  }
  return name;
}

export function validReportingMonth(month: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function reportingFilename(month: string) {
  if (!validReportingMonth(month)) throw new Error("Lună invalidă. Folosește formatul AAAA-LL.");
  return `Reporting b2b ${month}.xlsx`;
}

export function reportingSheets(technicians: ReportingTechnician[], entries: ReportingEntry[], month?: string): ExcelSheet[] {
  if (month !== undefined) {
    if (!validReportingMonth(month)) throw new Error("Lună invalidă. Folosește formatul AAAA-LL.");
    entries = entries.filter(entry => entry.date.slice(0, 7) === month);
  }
  const names = new Set(["centralizator"]);
  const technicianSheets: ExcelSheet[] = [];
  const summaries: ExcelCell[][] = [];
  const dates = [...new Set(entries.map(entry => entry.date))].sort();
  const defaults: Position[] = [
    ...boqCatalog.filter(item => item.category === "Manoperă").map(item => ({
      source: "Vodafone" as const, code: String(item.row), name: item.name, unit: item.unit, price: item.unitPrice,
    })),
    ...orangeServicePackages.map(item => ({
      source: "Orange/OROC" as const, code: item.code, name: item.label, unit: item.unit,
      price: item.code === "SP2 FOA" ? 300 : null,
    })),
  ];

  for (const technician of technicians) {
    const base = technician.name.replace(/[\\/?:*\[\]\u0000-\u001f]/g, " ").replace(/^'+|'+$/g, "").trim() || technician.username;
    let sheetName = base.slice(0, 31);
    let suffix = 1;
    while (names.has(sheetName.toLowerCase())) {
      const ending = ` (${suffix++})`;
      sheetName = base.slice(0, 31 - ending.length) + ending;
    }
    names.add(sheetName.toLowerCase());
    const quote = `'${sheetName.replaceAll("'", "''")}'`;
    const own = entries.filter(entry => entry.username === technician.username);
    const positions = new Map(defaults.map(item => [positionKey(item), item]));
    for (const entry of own) positions.set(positionKey(entry), entry);
    const works = [...new Set(own.map(entry => JSON.stringify([entry.source, entry.workId, entry.date])))].sort();
    const workCount = Math.max(1, works.length);
    const lastColumn = column(6 + workCount);
    const rows: ExcelCell[][] = [];
    const quantities = new Map<string, number>();
    for (const entry of own) {
      const key = positionKey(entry) + JSON.stringify([entry.source, entry.workId, entry.date]);
      quantities.set(key, (quantities.get(key) ?? 0) + entry.quantity);
    }
    let vodafone = 0, orange = 0, missing = 0;
    for (const [key, item] of positions) {
      const rowNumber = rows.length + 5;
      const values = works.map(work => quantities.get(key + work) ?? 0);
      const quantity = values.reduce((sum, value) => sum + value, 0);
      const amount = quantity * (item.price ?? 0);
      if (item.source === "Vodafone") vodafone += amount;
      else orange += amount;
      if (item.price === null && quantity > 0) missing++;
      rows.push([
        item.source, item.code, item.name, item.unit, item.price ?? "Tarif lipsă",
        { formula: `SUM(H${rowNumber}:${lastColumn}${rowNumber})`, value: quantity },
        { formula: `IF(ISNUMBER(E${rowNumber}),E${rowNumber}*F${rowNumber},0)`, value: amount },
        ...(works.length ? values : [null]),
      ]);
    }
    const lastData = rows.length + 4;
    const totalRow = lastData + 1;
    const summary = (label: string, formula: string, value: number): ExcelCell[] => [label, "", "", "", "", "", { formula, value }];
    rows.push(summary("TOTAL VODAFONE", `SUMIF(A5:A${lastData},"Vodafone",G5:G${lastData})`, vodafone));
    rows.push(summary("TOTAL ORANGE/OROC", `SUMIF(A5:A${lastData},"Orange/OROC",G5:G${lastData})`, orange));
    rows.push(summary("TOTAL CONFIRMAT EUR", `SUM(G${totalRow}:G${totalRow + 1})`, vodafone + orange));
    rows.push(summary("POZIȚII CU TARIF LIPSĂ", `COUNTIFS(E5:E${lastData},"Tarif lipsă",F5:F${lastData},">0")`, missing));
    // One work/date occupies one column. Daily amounts reconcile to the same
    // quantities and prices as the per-position totals.
    const dailyRow = lastData + 5;
    const daily: ExcelCell[] = ["TOTAL PE LUCRARE / DATĂ", "", "", "", "", "", null];
    for (let index = 0; index < workCount; index++) {
      const letter = column(index + 7);
      const work = works[index];
      const amount = work ? own.filter(entry => JSON.stringify([entry.source, entry.workId, entry.date]) === work)
        .reduce((sum, entry) => sum + entry.quantity * (entry.price ?? 0), 0) : 0;
      daily.push({ formula: `SUMPRODUCT(${letter}5:${letter}${lastData},E5:E${lastData})`, value: amount });
    }
    rows.push(daily);
    const headers = ["Furnizor", "Poziție / cod", "Manoperă / pachet", "UM", "Tarif EUR fără TVA", "Cantitate totală", "Valoare confirmată EUR"];
    for (const work of works) {
      const [source, id, date] = JSON.parse(work) as string[];
      headers.push(`${id}\n${date}\n${source}`);
    }
    if (!works.length) headers.push("Lucrare / tichet\nData execuției");
    technicianSheets.push({
      name: sheetName, title: `${technician.name} · @${technician.username}${month ? ` · ${month}` : ""}`, subtitle: "",
      headers, widths: [18, 17, 85, 24, 22, 22, 26, ...Array(workCount).fill(25)],
      rows, moneyColumns: [4, 6], numericColumns: [5, ...Array.from({ length: workCount }, (_, index) => index + 7)],
      dataRowCount: positions.size,
    });
    const summaryRow: ExcelCell[] = [technician.name, technician.username,
      { formula: `${quote}!G${totalRow}`, value: vodafone },
      { formula: `${quote}!G${totalRow + 1}`, value: orange },
      { formula: `${quote}!G${totalRow + 2}`, value: vodafone + orange },
      { formula: `${quote}!G${totalRow + 3}`, value: missing }];
    for (const date of dates) {
      const indexes = works.map((work, index) => ({ date: JSON.parse(work)[2], index })).filter(work => work.date === date);
      const formula = indexes.length ? indexes.map(work => `${quote}!${column(work.index + 7)}${dailyRow}`).join("+") : "0";
      const amount = own.filter(entry => entry.date === date).reduce((sum, entry) => sum + entry.quantity * (entry.price ?? 0), 0);
      summaryRow.push({ formula, value: amount });
    }
    summaries.push(summaryRow);
  }
  const totals: ExcelCell[] = ["TOTAL", ""];
  for (let index = 2; index < 6 + dates.length; index++) {
    const letter = column(index);
    const total = summaries.reduce((sum, row) => {
      const cell = row[index];
      return sum + (typeof cell === "object" && cell !== null && "value" in cell ? cell.value : 0);
    }, 0);
    totals.push({ formula: summaries.length ? `SUM(${letter}5:${letter}${summaries.length + 4})` : "0", value: total });
  }
  summaries.push(totals);
  return [{
    name: "Centralizator", title: `Realizări tehnicieni${month ? ` · ${month}` : ""} · Vodafone și Orange/OROC`, subtitle: "",
    headers: ["Tehnician", "Username", "Vodafone EUR", "Orange/OROC EUR", "Total confirmat EUR", "Poziții cu tarif lipsă", ...dates],
    widths: [27, 25, 22, 23, 25, 26, ...dates.map(() => 22)], rows: summaries,
    moneyColumns: [2, 3, 4, ...dates.map((_, index) => index + 6)], numericColumns: [5], dataRowCount: technicians.length,
  }, ...technicianSheets];
}
