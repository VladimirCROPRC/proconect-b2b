import { env } from "cloudflare:workers";
import { getRawDb } from "../db";
import { orangeMaterials, proconectMaterials } from "./orange-materials";
import { zipPackage } from "./report-docx";

type AssetEnvironment = { ASSETS?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };
type Material = { source?: string; code?: string; quantity?: number };
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

async function selectedMaterials(projectId: string) {
  const row = await getRawDb().prepare("SELECT content_json FROM project_field_documentation WHERE project_id = ? LIMIT 1").bind(projectId).first<{ content_json: string }>();
  if (!row?.content_json) return [] as Material[];
  try {
    const documentation = JSON.parse(row.content_json) as { intervention?: { execution?: { materials?: Material[] } } };
    return Array.isArray(documentation.intervention?.execution?.materials) ? documentation.intervention!.execution!.materials! : [];
  } catch {
    return [] as Material[];
  }
}

/** Builds the approved QAF and fills only the material quantity cells selected by the technician. */
export async function buildOrangeQafXlsx(projectId: string) {
  const assets = (env as unknown as AssetEnvironment).ASSETS;
  if (!assets) throw new Error("Șablonul QAF Orange nu este disponibil în configurația aplicației.");
  const response = await assets.fetch(new Request("https://assets.local/templates/QAF.xlsx"));
  if (!response.ok) throw new Error("Șablonul QAF Orange nu a putut fi încărcat.");
  const files = await unzip(new Uint8Array(await response.arrayBuffer()));
  const quantities = new Map<string, number>();
  for (const item of await selectedMaterials(projectId)) {
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
  const workbook = zipPackage(files);
  return workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength) as ArrayBuffer;
}
