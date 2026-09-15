import { env } from "cloudflare:workers";

type AssetEnvironment = { ASSETS?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };

/** Returns an exact copy of the approved QAF workbook bundled with the application. */
export async function buildOrangeQafXlsx() {
  const assets = (env as unknown as AssetEnvironment).ASSETS;
  if (!assets) throw new Error("Șablonul QAF Orange nu este disponibil în configurația aplicației.");
  const response = await assets.fetch(new Request("https://assets.local/templates/QAF.xlsx"));
  if (!response.ok) throw new Error("Șablonul QAF Orange nu a putut fi încărcat.");
  return response.arrayBuffer();
}
