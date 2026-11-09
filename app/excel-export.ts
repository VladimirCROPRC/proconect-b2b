// Minimal OOXML workbook writer. Cells are typed explicitly; text is never
// interpreted as a formula. ZIP uses the standard stored method (no dependency).
export type ExcelCell = string | number | null | { formula: string; value: number } | { date: string };
export type ExcelSheet = {
  name: string;
  title: string;
  subtitle: string;
  headers: string[];
  widths: number[];
  rows: ExcelCell[][];
  numericColumns?: number[];
  moneyColumns?: number[];
  dataRowCount?: number;
};

const encoder = new TextEncoder();
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function column(index: number) {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
function cell(value: ExcelCell, address: string, style: number) {
  if (value === null) return `<c r="${address}" s="${style}"/>`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Valoare numerică invalidă în export.");
    return `<c r="${address}" s="${style}"><v>${value}</v></c>`;
  }
  if (typeof value === "object") {
    if ("date" in value) {
      const timestamp = Date.parse(value.date + "T00:00:00Z");
      if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value.date) throw new Error("Dată invalidă în export.");
      const serial = timestamp / 86400000 + 25569;
      return `<c r="${address}" s="5"><v>${serial}</v></c>`;
    }
    if (!Number.isFinite(value.value)) throw new Error("Rezultat numeric invalid în export.");
    return `<c r="${address}" s="${style}"><f>${xml(value.formula)}</f><v>${value.value}</v></c>`;
  }
  return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value.slice(0, 32767))}</t></is></c>`;
}
function sheetXml(sheet: ExcelSheet) {
  const data = [
    `<row r="1" ht="28" customHeight="1">${cell(sheet.title, "A1", 1)}</row>`,
    `<row r="2" ht="30" customHeight="1">${cell(sheet.subtitle, "A2", 0)}</row>`,
    `<row r="4" ht="32" customHeight="1">${sheet.headers.map((title, i) => cell(title, `${column(i)}4`, 2)).join("")}</row>`,
    ...sheet.rows.map((row, index) => {
      const lines = Math.max(1, ...row.map((value, i) => typeof value === "string" ? value.split("\n").reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / (sheet.widths[i] || 20))), 0) : 1));
      return `<row r="${index + 5}" ht="${Math.min(409, Math.max(26, lines * 15 + 8))}" customHeight="1">${row.map((value, i) => cell(value, `${column(i)}${index + 5}`, sheet.moneyColumns?.includes(i) ? 3 : sheet.numericColumns?.includes(i) ? 4 : 0)).join("")}</row>`;
    }),
  ];
  const last = column(sheet.headers.length - 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}${sheet.rows.length + 4}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${sheet.widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${data.join("")}</sheetData><autoFilter ref="A4:${last}${Math.max(4, (sheet.dataRowCount ?? sheet.rows.length - 1) + 4)}"/><mergeCells count="2"><mergeCell ref="A1:${last}1"/><mergeCell ref="A2:${last}2"/></mergeCells><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}
const styles = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00&quot; EUR&quot;"/><numFmt numFmtId="165" formatCode="0.#####"/><numFmt numFmtId="166" formatCode="dd.mm.yyyy"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FF143454"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF143454"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function header(size: number) { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; }
function zip(files: Record<string, string>) {
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0, centralSize = 0;
  for (const [name, content] of Object.entries(files)) {
    const path = encoder.encode(name), data = encoder.encode(content), crc = crc32(data);
    const l = header(30 + path.length);
    l.view.setUint32(0, 0x04034b50, true); l.view.setUint16(4, 20, true);
    l.view.setUint16(6, 0x800, true); l.view.setUint16(12, 0x21, true);
    l.view.setUint32(14, crc, true); l.view.setUint32(18, data.length, true); l.view.setUint32(22, data.length, true);
    l.view.setUint16(26, path.length, true); l.bytes.set(path, 30);
    const c = header(46 + path.length);
    c.view.setUint32(0, 0x02014b50, true); c.view.setUint16(4, 20, true); c.view.setUint16(6, 20, true);
    c.view.setUint16(8, 0x800, true); c.view.setUint16(14, 0x21, true);
    c.view.setUint32(16, crc, true); c.view.setUint32(20, data.length, true); c.view.setUint32(24, data.length, true);
    c.view.setUint16(28, path.length, true); c.view.setUint32(42, offset, true); c.bytes.set(path, 46);
    local.push(l.bytes, data); central.push(c.bytes); offset += l.bytes.length + data.length; centralSize += c.bytes.length;
  }
  const end = header(22), count = central.length;
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, count, true); end.view.setUint16(10, count, true);
  end.view.setUint32(12, centralSize, true); end.view.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const part of [...local, ...central, end.bytes]) { output.set(part, cursor); cursor += part.length; }
  return output;
}

export function createExcelWorkbook(input: ExcelSheet | ExcelSheet[]) {
  const sheets = Array.isArray(input) ? input : [input];
  if (!sheets.length) throw new Error("Registrul trebuie să conțină cel puțin o foaie.");
  const names = new Set<string>();
  for (const sheet of sheets) {
    if (!sheet.name || sheet.name.length > 31 || /[\\/?:*\[\]]/.test(sheet.name) || sheet.name.startsWith("'") || sheet.name.endsWith("'") || names.has(sheet.name.toLowerCase())) throw new Error("Nume de foaie Excel invalid sau duplicat.");
    names.add(sheet.name.toLowerCase());
  }
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": styles,
  };
  sheets.forEach((sheet, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheet); });
  return zip(files);
}

export function downloadExcel(sheet: ExcelSheet | ExcelSheet[], filename: string) {
  const bytes = createExcelWorkbook(sheet);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename.replace(/[^\p{L}\p{N}._-]/gu, "_"); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
