import { env } from "cloudflare:workers";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

type LayerMeta = {
  id: string;
  name: string;
  featureCount: number;
  color: string;
  visible: boolean;
  createdAt: number;
  uploadedBy: string;
};

type BucketObject = {
  body: ReadableStream;
};

type LayerEnvironment = {
  BUCKET?: {
    get(key: string): Promise<BucketObject | null>;
    put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
    delete(key: string): Promise<void>;
  };
};

const layerEnv = env as unknown as LayerEnvironment;
const indexKey = "map-layers/index.json";
const colors = ["#ffcf33", "#ff5b5b", "#32d6ff", "#83f28f", "#f394ff", "#ff914d", "#ffffff"];

async function readText(stream: ReadableStream) {
  return new Response(stream).text();
}

async function readIndex(): Promise<LayerMeta[]> {
  const object = await layerEnv.BUCKET?.get(indexKey);
  if (!object) return [];
  try {
    const value = JSON.parse(await readText(object.body));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function allowedToView(role: string) {
  return role === "Admin" || role === "Manager" || role === "Coordonator";
}

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!allowedToView(session.account.role)) return Response.json({ error: "Nu ai acces la straturile de infrastructură." }, { status: 403 });
    if (!layerEnv.BUCKET) return Response.json({ error: "Stocarea straturilor nu este configurată." }, { status: 503 });

    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return Response.json({ layers: await readIndex() }, { headers: { "Cache-Control": "no-store" } });
    if (!/^[a-z0-9-]{8,80}$/i.test(id)) return Response.json({ error: "Strat invalid." }, { status: 400 });
    const layer = await layerEnv.BUCKET.get(`map-layers/${id}.geojson`);
    if (!layer) return Response.json({ error: "Stratul nu a fost găsit." }, { status: 404 });
    return new Response(layer.body, { headers: { "Content-Type": "application/geo+json", "Cache-Control": "private, max-age=300" } });
  } catch {
    return Response.json({ error: "Straturile nu sunt disponibile momentan." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (session.account.role !== "Admin") return Response.json({ error: "Numai administratorul poate publica straturi." }, { status: 403 });
    if (!layerEnv.BUCKET) return Response.json({ error: "Stocarea straturilor nu este configurată." }, { status: 503 });

    const body = await request.json() as { name?: unknown; geojson?: unknown; color?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const collection = body.geojson as { type?: unknown; features?: unknown[] } | null;
    if (!name || !collection || collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
      return Response.json({ error: "Stratul GeoJSON rezultat nu este valid." }, { status: 400 });
    }
    if (!collection.features.length || collection.features.length > 100_000) {
      return Response.json({ error: "Stratul trebuie să conțină între 1 și 100.000 de obiecte." }, { status: 400 });
    }
    const serialized = JSON.stringify(collection);
    if (serialized.length > 25_000_000) return Response.json({ error: "Stratul convertit depășește limita de 25 MB." }, { status: 413 });

    const id = crypto.randomUUID();
    const index = await readIndex();
    const color = typeof body.color === "string" && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : colors[index.length % colors.length];
    const meta: LayerMeta = {
      id,
      name,
      featureCount: collection.features.length,
      color,
      visible: true,
      createdAt: Date.now(),
      uploadedBy: session.account.username,
    };
    await layerEnv.BUCKET.put(`map-layers/${id}.geojson`, serialized, { httpMetadata: { contentType: "application/geo+json" } });
    await layerEnv.BUCKET.put(indexKey, JSON.stringify([meta, ...index]), { httpMetadata: { contentType: "application/json" } });
    return Response.json({ layer: meta }, { status: 201 });
  } catch (error) {
    console.error("Map layer upload error:", error instanceof Error ? error.message : "Unknown layer failure");
    return Response.json({ error: "Stratul nu a putut fi publicat." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (session.account.role !== "Admin") return Response.json({ error: "Numai administratorul poate șterge straturi." }, { status: 403 });
    if (!layerEnv.BUCKET) return Response.json({ error: "Stocarea straturilor nu este configurată." }, { status: 503 });
    const body = await request.json() as { id?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!/^[a-z0-9-]{8,80}$/i.test(id)) return Response.json({ error: "Strat invalid." }, { status: 400 });
    const index = await readIndex();
    await layerEnv.BUCKET.delete(`map-layers/${id}.geojson`);
    await layerEnv.BUCKET.put(indexKey, JSON.stringify(index.filter((layer) => layer.id !== id)), { httpMetadata: { contentType: "application/json" } });
    return Response.json({ deleted: true });
  } catch {
    return Response.json({ error: "Stratul nu a putut fi șters." }, { status: 503 });
  }
}
