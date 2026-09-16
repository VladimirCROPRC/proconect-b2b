import { env } from "cloudflare:workers";
import { getRawDb } from "../db";
import { orangeMaterials, proconectMaterials } from "./orange-materials";
import { zipPackage } from "./report-docx";

type AssetEnvironment = { ASSETS?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };
type Material = { source?: string; code?: string; quantity?: number };
type DamageLocation = { lat?: number; lon?: number; placedAt?: number };
type ZipEntry = { name: string; content: Uint8Array };
const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Șablonul QAF Orange nu este un fișier Excel valid.");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const files: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Arhiva QAF Orange este coruptă.");
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(start, start + compressedSize);
    let content: Uint8Array;
    if (method === 0) {
      content = compressed.slice();
    } else if (method === 8) {
      const input = compressed.slice().buffer;
      const stream = new Response(input).body!.pipeThrough(new DecompressionStream("deflate-raw"));
      content = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error("Șablonul QAF Orange folosește o compresie nesuportată.");
    }
    files.push({ name, content });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function writeQuantity(xml: string, cell: string, quantity: number) {
  const value = Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(3)));
  const selfClosing = new RegExp(`<c r="${cell}"([^>]*)\\/>`);
  if (selfClosing.test(xml)) return xml.replace(selfClosing, `<c r="${cell}"$1><v>${value}</v></c>`);
  const populated = new RegExp(`<c r="${cell}"([^>]*)>.*?<\\/c>`);
  return populated.test(xml) ? xml.replace(populated, `<c r="${cell}"$1><v>${value}</v></c>`) : xml;
}

async function orangeDocumentation(projectId: string) {
  const row = await getRawDb().prepare("SELECT content_json FROM project_field_documentation WHERE project_id = ? LIMIT 1").bind(projectId).first<{ content_json: string }>();
  if (!row?.content_json) return { materials: [] as Material[] };
  try {
    const documentation = JSON.parse(row.content_json) as { intervention?: { assessment?: { damageLocation?: DamageLocation; documentedAt?: number }; execution?: { materials?: Material[] } } };
    return {
      materials: Array.isArray(documentation.intervention?.execution?.materials) ? documentation.intervention!.execution!.materials! : [],
      damageLocation: documentation.intervention?.assessment?.damageLocation,
      documentedAt: documentation.intervention?.assessment?.documentedAt,
    };
  } catch {
    return { materials: [] as Material[] };
  }
}

function writeNumber(xml: string, cell: string, value: number) {
  return writeQuantity(xml, cell, value);
}

function writeText(xml: string, cell: string, value: string) {
  const selfClosing = new RegExp(`<c r="${cell}"([^>]*)\\/>`);
  const populated = new RegExp(`<c r="${cell}"([^>]*)>.*?<\\/c>`);
  const render = (attributes: string) => `<c r="${cell}"${attributes.replace(/\\s+t="[^"]*"/g, "")} t="inlineStr"><is><t>${value}</t></is></c>`;
  const empty = selfClosing.exec(xml);
  if (empty) return xml.replace(empty[0], render(empty[1]));
  const existing = populated.exec(xml);
  return existing ? xml.replace(existing[0], render(existing[1])) : xml;
}

function localPlacement(timestamp: number | undefined) {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  const parts = new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const day = Number(value("day"));
  const month = Number(value("month"));
  const year = Number(value("year"));
  const hour = value("hour");
  const minute = value("minute");
  return Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year) && hour && minute
    ? { day, month, year, time: `${hour}:${minute}` }
    : null;
}

/** Builds the approved QAF and fills only the material quantity cells selected by the technician. */
export async function buildOrangeQafXlsx(projectId: string) {
  const assets = (env as unknown as AssetEnvironment).ASSETS;
  if (!assets) throw new Error("Șablonul QAF Orange nu este disponibil în configurația aplicației.");
  const response = await assets.fetch(new Request("https://assets.local/templates/QAF.xlsx"));
  if (!response.ok) throw new Error("Șablonul QAF Orange nu a putut fi încărcat.");
  const files = await unzip(new Uint8Array(await response.arrayBuffer()));
  const documentation = await orangeDocumentation(projectId);
  const quantities = new Map<string, number>();
  for (const item of documentation.materials) {
    const quantity = Number(item.quantity);
    if ((item.source !== "orange" && item.source !== "proconect") || !item.code || !Number.isFinite(quantity) || quantity <= 0) continue;
    const key = `${item.source}:${item.code}`;
    quantities.set(key, (quantities.get(key) ?? 0) + quantity);
  }
  const sheets = [
    { name: "xl/worksheets/sheet2.xml", source: "orange", column: "D", catalog: orangeMaterials },
    { name: "xl/worksheets/sheet3.xml", source: "proconect", column: "E", catalog: proconectMaterials },
  ] as const;
  for (const sheet of sheets) {
    const entry = files.find((file) => file.name === sheet.name);
    if (!entry) throw new Error("Șablonul QAF Orange nu conține foile de materiale.");
    let xml = decoder.decode(entry.content);
    sheet.catalog.forEach((item, index) => {
      const quantity = quantities.get(`${sheet.source}:${item.code}`);
      if (quantity) xml = writeQuantity(xml, `${sheet.column}${index + 2}`, quantity);
    });
    entry.content = encoder.encode(xml);
  }
  const main = files.find((file) => file.name === "xl/worksheets/sheet1.xml");
  if (!main) throw new Error("Șablonul QAF Orange nu conține foaia principală.");
  const location = documentation.damageLocation;
  const placed = localPlacement(location?.placedAt ?? documentation.documentedAt);
  let mainXml = decoder.decode(main.content);
  if (location && Number.isFinite(location.lat) && Number.isFinite(location.lon)) {
    mainXml = writeNumber(mainXml, "C34", Number(location.lat!.toFixed(6)));
    mainXml = writeNumber(mainXml, "E34", Number(location.lon!.toFixed(6)));
  }
  if (placed) {
    for (const row of [19, 20]) {
      mainXml = writeNumber(mainXml, `C${row}`, placed.day);
      mainXml = writeNumber(mainXml, `D${row}`, placed.month);
      mainXml = writeNumber(mainXml, `E${row}`, placed.year);
      mainXml = writeText(mainXml, `G${row}`, placed.time);
    }
  }
  main.content = encoder.encode(mainXml);

  const workbook = zipPackage(files);
  return workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength) as ArrayBuffer;
}
