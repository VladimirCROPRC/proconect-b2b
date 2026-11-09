import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import type { BudgetSuggestion } from "./project-budget";
import { localDate } from "./technician-report";

const escapeXml = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function editCell(sheet: string, address: string, edit: (attributes: string, body: string) => string) {
  let found = false;
  const result = sheet.replace(new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*?)(?:/>|>([\\s\\S]*?)</c>)`), (_whole, attributes: string, body: string | undefined) => {
    found = true;
    return edit(attributes.replace(/\/$/, ""), body ?? "");
  });
  if (!found) throw new Error(`Celula ${address} lipsește din modelul de deviz.`);
  return result;
}
function valueCell(sheet: string, address: string, value: string | number) {
  return editCell(sheet, address, attributes => {
    attributes = attributes.replace(/\s+t="[^"]*"/g, "");
    return typeof value === "number" ? `<c${attributes}><v>${value}</v></c>` : `<c${attributes} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  });
}
function cachedFormula(sheet: string, address: string, value: number) {
  return editCell(sheet, address, (attributes, body) => {
    if (!/<f\b/.test(body)) throw new Error(`Formula din ${address} lipsește din model.`);
    const updated = /<v>[^<]*<\/v>/.test(body) ? body.replace(/<v>[^<]*<\/v>/, `<v>${value}</v>`) : body + `<v>${value}</v>`;
    return `<c${attributes}>${updated}</c>`;
  });
}

export function fillEstimateTemplate(template: Uint8Array, project: { id: string; client: string }, rows: BudgetSuggestion[], date = localDate(Date.now())) {
  const files = unzipSync(template);
  let sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const quantities = new Map<number, number>();
  for (const row of rows) {
    if (!row.selected || row.catalogPosition === "included") continue;
    const position = Number(row.catalogPosition);
    if (!Number.isInteger(position) || position < 8 || position > 208 || !Number.isFinite(row.quantity) || row.quantity <= 0) throw new Error("Poziție de deviz invalidă pentru model.");
    quantities.set(position, (quantities.get(position) ?? 0) + row.quantity);
  }
  let total = 0;
  for (const [position, quantity] of [...quantities].sort((a, b) => a[0] - b[0])) {
    const priceCell = sheet.match(new RegExp(`<c\\b[^>]*\\br="G${position}"[^>]*>([\\s\\S]*?)</c>`))?.[1];
    const price = Number(priceCell?.match(/<v>([^<]+)<\/v>/)?.[1]);
    if (!Number.isFinite(price)) throw new Error("Tariful din model nu este valid.");
    const amount = quantity * price;
    total += amount;
    sheet = valueCell(sheet, `E${position}`, quantity);
    sheet = cachedFormula(sheet, `H${position}`, amount);
  }
  sheet = cachedFormula(sheet, "E6", total);
  sheet = valueCell(sheet, "C2", Date.parse(date + "T00:00:00Z") / 86400000 + 25569);
  sheet = valueCell(sheet, "C3", "Proconect");
  sheet = valueCell(sheet, "C4", project.client);
  sheet = valueCell(sheet, "E4", project.id);
  files["xl/worksheets/sheet1.xml"] = strToU8(sheet);
  // Keep the original formulas, shared formula ranges, styles, validations,
  // protection, both worksheets and print layout. Cached amounts are current.
  return zipSync(files, { level: 6 });
}

export async function downloadEstimateTemplate(project: { id: string; client: string }, rows: BudgetSuggestion[]) {
  const response = await fetch("/templates/boq-vbts-fo-prc.xlsx", { cache: "force-cache" });
  if (!response.ok) throw new Error("Modelul Excel nu este disponibil.");
  const bytes = fillEstimateTemplate(new Uint8Array(await response.arrayBuffer()), project, rows);
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url; link.download = `Deviz-${project.id.replace(/[^a-z0-9_-]/gi, "_")}.xlsx`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
