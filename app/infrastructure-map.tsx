"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import initGdalJs from "gdal3.js";
import workerUrl from "gdal3.js/dist/package/gdal3.js?url";
import dataUrl from "gdal3.js/dist/package/gdal3WebAssembly.data?url";
import wasmUrl from "gdal3.js/dist/package/gdal3WebAssembly.wasm?url";
import { useMapGestures } from "./use-map-gestures";
import { useMapFullscreen } from "./use-map-fullscreen";

type Coordinate = { lat: number; lon: number };
type LayerMeta = { id: string; name: string; featureCount: number; color: string; visible: boolean; createdAt: number; uploadedBy: string };
type Geometry = { type: string; coordinates: unknown };
type FeatureCollection = { type: "FeatureCollection"; features: Array<{ type: "Feature"; geometry: Geometry | null; properties?: Record<string, unknown> }> };
type LoadedLayer = LayerMeta & { data?: FeatureCollection; enabled: boolean };

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 600;
const TILE_SIZE = 256;
const DEFAULT_CENTER: Coordinate = { lat: 44.4268, lon: 26.1025 };

function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
function project(point: Coordinate, zoom: number) {
  const size = TILE_SIZE * 2 ** zoom;
  const latitude = clamp(point.lat, -85.05112878, 85.05112878);
  const sin = Math.sin((latitude * Math.PI) / 180);
  return { x: ((point.lon + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}
function unproject(point: { x: number; y: number }, zoom: number): Coordinate {
  const size = TILE_SIZE * 2 ** zoom;
  const longitude = (point.x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / size;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon: longitude };
}
function screenPoint(coordinate: number[], center: Coordinate, zoom: number) {
  const point = project({ lon: coordinate[0], lat: coordinate[1] }, zoom);
  const origin = project(center, zoom);
  return { x: point.x - origin.x + MAP_WIDTH / 2, y: point.y - origin.y + MAP_HEIGHT / 2 };
}
function forEachCoordinate(value: unknown, visit: (coordinate: number[]) => void) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    visit(value as number[]);
    return;
  }
  for (const child of value) forEachCoordinate(child, visit);
}
function geometryParts(geometry: Geometry) {
  const coordinates = geometry.coordinates as unknown;
  if (geometry.type === "Point") return [[coordinates as number[]]];
  if (geometry.type === "MultiPoint" || geometry.type === "LineString") return [coordinates as number[][]];
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") return coordinates as number[][][];
  if (geometry.type === "MultiPolygon") return (coordinates as number[][][][]).flat();
  return [] as number[][][];
}

export function InfrastructureMap({ role, onNotify }: { role: string; onNotify: (message: string) => void }) {
  const [layers, setLayers] = useState<LoadedLayer[]>([]);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(13);
  const [opacity, setOpacity] = useState(0.9);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [layerName, setLayerName] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fullscreen = useMapFullscreen();

  const gestures = useMapGestures({ center, zoom, setCenter, setZoom, project, unproject, mapWidth: MAP_WIDTH, mapHeight: MAP_HEIGHT, minimumZoom: 7, maximumZoom: 20, mousePan: true });

  async function loadLayerData(meta: LayerMeta) {
    const response = await fetch(`/api/map-layers?id=${encodeURIComponent(meta.id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Stratul nu a putut fi încărcat.");
    return response.json() as Promise<FeatureCollection>;
  }

  useEffect(() => {
    let active = true;
    fetch("/api/map-layers", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { layers?: LayerMeta[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Lista straturilor nu este disponibilă.");
        const metas = payload.layers ?? [];
        const loaded = await Promise.all(metas.map(async (meta) => ({ ...meta, enabled: meta.visible, data: await loadLayerData(meta) })));
        if (active) setLayers(loaded);
      })
      .catch((error) => onNotify(error instanceof Error ? error.message : "Straturile nu sunt disponibile."))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const tiles = useMemo(() => {
    const sourceZoom = Math.min(zoom, 19);
    const scale = 2 ** (zoom - sourceZoom);
    const tileSize = TILE_SIZE * scale;
    const origin = project(center, zoom);
    const count = 2 ** sourceZoom;
    const firstX = Math.floor((origin.x - MAP_WIDTH / 2) / tileSize);
    const lastX = Math.floor((origin.x + MAP_WIDTH / 2) / tileSize);
    const firstY = Math.floor((origin.y - MAP_HEIGHT / 2) / tileSize);
    const lastY = Math.floor((origin.y + MAP_HEIGHT / 2) / tileSize);
    const result: Array<{ key: string; x: number; y: number; size: number; z: number; tx: number; ty: number }> = [];
    for (let x = firstX; x <= lastX; x += 1) for (let y = firstY; y <= lastY; y += 1) {
      if (y < 0 || y >= count) continue;
      result.push({ key: `${zoom}-${x}-${y}`, x: x * tileSize - (origin.x - MAP_WIDTH / 2), y: y * tileSize - (origin.y - MAP_HEIGHT / 2), size: tileSize, z: sourceZoom, tx: ((x % count) + count) % count, ty: y });
    }
    return result;
  }, [center, zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = MAP_WIDTH;
    canvas.height = MAP_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    context.globalAlpha = opacity;
    context.lineJoin = "round";
    context.lineCap = "round";
    for (const layer of layers) {
      if (!layer.enabled || !layer.data) continue;
      context.strokeStyle = layer.color;
      context.fillStyle = layer.color + "33";
      context.lineWidth = 3;
      for (const feature of layer.data.features) {
        if (!feature.geometry) continue;
        for (const part of geometryParts(feature.geometry)) {
          if (!part.length) continue;
          if (feature.geometry.type === "Point" || feature.geometry.type === "MultiPoint") {
            for (const coordinate of part) {
              const point = screenPoint(coordinate, center, zoom);
              context.beginPath(); context.arc(point.x, point.y, 5, 0, Math.PI * 2); context.fill(); context.stroke();
            }
            continue;
          }
          context.beginPath();
          part.forEach((coordinate, index) => {
            const point = screenPoint(coordinate, center, zoom);
            if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
          });
          if (feature.geometry.type.includes("Polygon")) { context.closePath(); context.fill(); }
          context.stroke();
        }
      }
    }
    context.globalAlpha = 1;
  }, [center, layers, opacity, zoom]);

  function fitAll() {
    const coordinates: number[][] = [];
    for (const layer of layers) if (layer.enabled && layer.data) for (const feature of layer.data.features) if (feature.geometry) forEachCoordinate(feature.geometry.coordinates, (coordinate) => coordinates.push(coordinate));
    if (!coordinates.length) return;
    const minLon = Math.min(...coordinates.map((point) => point[0]));
    const maxLon = Math.max(...coordinates.map((point) => point[0]));
    const minLat = Math.min(...coordinates.map((point) => point[1]));
    const maxLat = Math.max(...coordinates.map((point) => point[1]));
    setCenter({ lon: (minLon + maxLon) / 2, lat: (minLat + maxLat) / 2 });
    for (let candidate = 19; candidate >= 7; candidate -= 1) {
      const a = project({ lon: minLon, lat: minLat }, candidate);
      const b = project({ lon: maxLon, lat: maxLat }, candidate);
      if (Math.abs(b.x - a.x) < MAP_WIDTH * 0.82 && Math.abs(b.y - a.y) < MAP_HEIGHT * 0.82) { setZoom(candidate); break; }
    }
  }

  function selectMapInfoFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const extensions = new Set(files.map((file) => file.name.split(".").pop()?.toLowerCase()));
    const missing = ["tab", "dat", "map", "id"].filter((extension) => !extensions.has(extension));
    if (missing.length) {
      setSelectedFiles([]);
      onNotify(`Lipsesc fișierele: ${missing.map((item) => "." + item.toUpperCase()).join(", ")}.`);
      return;
    }
    setSelectedFiles(files);
    const tab = files.find((file) => file.name.toLowerCase().endsWith(".tab"));
    setLayerName(tab?.name.replace(/\.tab$/i, "") ?? "");
  }

  async function convertAndPublish() {
    if (!selectedFiles.length || !layerName.trim()) return;
    setConverting(true);
    try {
      const Gdal = await initGdalJs({ paths: { wasm: wasmUrl, data: dataUrl, js: workerUrl } });
      const opened = await Gdal.open(selectedFiles);
      const dataset = opened.datasets[0];
      if (!dataset) throw new Error("Setul MapInfo nu a putut fi deschis.");
      const output = await Gdal.ogr2ogr(dataset, ["-f", "GeoJSON", "-t_srs", "EPSG:4326"]);
      const bytes = await Gdal.getFileBytes(output);
      const geojson = JSON.parse(new TextDecoder().decode(bytes)) as FeatureCollection;
      Gdal.close(dataset);
      const response = await fetch("/api/map-layers", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: layerName.trim(), geojson }) });
      const payload = await response.json() as { layer?: LayerMeta; error?: string };
      if (!response.ok || !payload.layer) throw new Error(payload.error || "Stratul nu a putut fi publicat.");
      setLayers((current) => [{ ...payload.layer!, enabled: true, data: geojson }, ...current]);
      setSelectedFiles([]);
      setLayerName("");
      onNotify(`Stratul ${payload.layer.name} a fost convertit și publicat.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Conversia MapInfo nu a reușit.");
    } finally {
      setConverting(false);
    }
  }

  async function deleteLayer(layer: LoadedLayer) {
    if (!window.confirm(`Ștergi stratul „${layer.name}”?`)) return;
    const response = await fetch("/api/map-layers", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: layer.id }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { onNotify(payload.error || "Stratul nu a putut fi șters."); return; }
    setLayers((current) => current.filter((item) => item.id !== layer.id));
    onNotify(`Stratul ${layer.name} a fost șters.`);
  }

  return <div className="page-wrap infrastructure-map-page">
    <section className="page-heading"><div><p className="eyebrow">INFRASTRUCTURĂ GIS</p><h1>Hartă infrastructură</h1><p>Straturi MapInfo peste imaginea satelitară Esri World Imagery.</p></div></section>
    {role === "Admin" && <section className="map-layer-upload">
      <div><strong>Publică strat MapInfo</strong><small>Selectează împreună fișierele TAB, DAT, MAP și ID; IND este opțional.</small></div>
      <label><input type="file" multiple accept=".tab,.dat,.map,.id,.ind" onChange={selectMapInfoFiles} disabled={converting} /><span>＋ Selectează fișiere</span></label>
      <input value={layerName} onChange={(event) => setLayerName(event.target.value)} placeholder="Denumirea stratului" />
      <button className="primary-button" onClick={convertAndPublish} disabled={!selectedFiles.length || !layerName.trim() || converting}>{converting ? "Se convertește…" : "Convertește și publică"}</button>
    </section>}
    <section className={`fo-map-card infrastructure-map-card ${fullscreen.fullscreen ? "map-fullscreen" : ""}`}>
      <div className="fo-map-head"><div><small>VEDERE SATELITARĂ</small><strong>{loading ? "Se încarcă…" : `${layers.length} ${layers.length === 1 ? "strat" : "straturi"}`}</strong></div><div className="infrastructure-map-actions"><button onClick={fitAll}>Încadrează straturile</button><button onClick={() => setZoom((value) => Math.min(20, value + 1))}>＋</button><button onClick={() => setZoom((value) => Math.max(7, value - 1))}>−</button><button className="fo-fullscreen-toggle" onClick={fullscreen.toggleFullscreen}>{fullscreen.fullscreen ? "× Închide" : "⛶ Ecran complet"}</button></div></div>
      <div className="fo-map mode-pan" onPointerDown={gestures.onPointerDown} onPointerMove={gestures.onPointerMove} onPointerUp={gestures.onPointerUp} onPointerCancel={gestures.onPointerCancel} onWheel={gestures.onWheel}>
        <div className="fo-map-tiles">{tiles.map((tile) => <img key={tile.key} src={`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tile.z}/${tile.ty}/${tile.tx}`} alt="" draggable={false} style={{ left: `${tile.x / MAP_WIDTH * 100}%`, top: `${tile.y / MAP_HEIGHT * 100}%`, width: `${tile.size / MAP_WIDTH * 100}%`, height: `${tile.size / MAP_HEIGHT * 100}%` }} />)}</div>
        <canvas ref={canvasRef} className="map-layer-canvas" />
        <div className="fo-map-instruction"><span>GIS</span>Glisează · pinch zoom · straturile sunt reproiectate în WGS84</div>
      </div>
      <div className="fo-map-footer infrastructure-layer-list">
        <div className="layer-opacity"><span>Opacitate</span><input type="range" min="20" max="100" value={Math.round(opacity * 100)} onChange={(event) => setOpacity(Number(event.target.value) / 100)} /></div>
        {layers.map((layer) => <div className="infrastructure-layer-row" key={layer.id}><label><input type="checkbox" checked={layer.enabled} onChange={(event) => setLayers((current) => current.map((item) => item.id === layer.id ? { ...item, enabled: event.target.checked } : item))} /><i style={{ background: layer.color }} /><span><strong>{layer.name}</strong><small>{layer.featureCount.toLocaleString("ro-RO")} obiecte</small></span></label>{role === "Admin" && <button onClick={() => void deleteLayer(layer)}>Șterge</button>}</div>)}
        {!loading && !layers.length && <p>Nu există încă straturi publicate.</p>}
      </div>
    </section>
  </div>;
}
