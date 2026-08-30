export type MapSiteRow = [code: string, description: string, region: string, lat: number, lon: number];

export type MapSitesPayload = {
  source: string;
  valid: number;
  rejected: Record<string, number>;
  schema: string[];
  sites: MapSiteRow[];
  updatedAt?: number;
};

export async function fetchMapSites(): Promise<MapSitesPayload> {
  const managed = await fetch("/api/map-sites", { cache: "no-store" });
  if (managed.ok) return managed.json() as Promise<MapSitesPayload>;
  const bundled = await fetch("/data/optix-sites.json");
  if (!bundled.ok) throw new Error("Lista site-urilor nu este disponibilă.");
  return bundled.json() as Promise<MapSitesPayload>;
}
