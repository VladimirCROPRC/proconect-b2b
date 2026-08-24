"use client";

import { useDeferredValue, useEffect, useMemo, useState, type MouseEvent } from "react";
import { fetchProjectFiles, uploadProjectFile } from "./client-storage";
import type { SpliceFieldSummary } from "./field-documentation";

type Coordinate = { lat: number; lon: number };
type OptixSiteRow = [code: string, description: string, region: string, lat: number, lon: number];
type OptixPayload = { source: string; valid: number; sites: OptixSiteRow[] };
type JunctionKind = "" | "existing" | "new";
type JunctionNetwork = "" | "mobile" | "fixed";
type SelectMode = "documented" | "undocumented";
type SplicePhotoKey = "open" | "closed" | "placed";

type SpliceProject = {
  id: string;
  client: string;
  address: string;
  technician: string;
  splice: string;
};

type Junction = Coordinate & {
  id: string;
  code: string;
  name: string;
  region: string;
  documented: boolean;
};

type SpliceRecord = {
  id: string;
  projectId: string;
  junction: Junction;
  junctionKind: JunctionKind;
  network: JunctionNetwork;
  siteBuffer: string;
  siteFiber: string;
  clientBuffer: string;
  clientFiber: string;
  photos: Record<SplicePhotoKey, string>;
};

type Props = {
  project: SpliceProject;
  initialSummary?: SpliceFieldSummary;
  onNotify: (message: string) => void;
  onSaved?: (summary: SpliceFieldSummary) => Promise<void> | void;
};

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 600;
const TILE_SIZE = 256;
const DEFAULT_CENTER: Coordinate = { lat: 44.4268, lon: 26.1025 };
const fiberColors = ["Albastru", "Portocaliu", "Verde", "Maro", "Gri", "Alb", "Roșu", "Negru", "Galben", "Violet", "Roz", "Turcoaz"];
const colorHex: Record<string, string> = {
  Albastru: "#2874c6",
  Portocaliu: "#ee8a24",
  Verde: "#2f9d62",
  Maro: "#8a5a3b",
  Gri: "#89909d",
  Alb: "#ffffff",
  Roșu: "#d94d55",
  Negru: "#252a33",
  Galben: "#e5bd28",
  Violet: "#8159be",
  Roz: "#dc77a4",
  Turcoaz: "#23a9a5",
};
const splicePhotoCatalog: Record<SplicePhotoKey, { title: string; description: string; badge: string }> = {
  open: { title: "Joncțiunea deschisă", description: "Interiorul joncțiunii și caseta de suduri vizibile.", badge: "DES" },
  closed: { title: "Joncțiunea închisă", description: "Joncțiunea închisă și securizată după intervenție.", badge: "ÎNC" },
  placed: { title: "Joncțiunea amplasată", description: "Poziția finală pe stâlp sau în camereta de telecomunicații.", badge: "LOC" },
};
const splicePhotoKeys = Object.keys(splicePhotoCatalog) as SplicePhotoKey[];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function project(point: Coordinate, zoom: number) {
  const size = TILE_SIZE * 2 ** zoom;
  const latitude = clamp(point.lat, -85.05112878, 85.05112878);
  const sin = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((point.lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

function unproject(point: { x: number; y: number }, zoom: number): Coordinate {
  const size = TILE_SIZE * 2 ** zoom;
  const longitude = (point.x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / size;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon: longitude };
}

function screenPoint(point: Coordinate, center: Coordinate, zoom: number) {
  const projected = project(point, zoom);
  const projectedCenter = project(center, zoom);
  return {
    x: projected.x - projectedCenter.x + MAP_WIDTH / 2,
    y: projected.y - projectedCenter.y + MAP_HEIGHT / 2,
  };
}

function lowerLatitudeBound(rows: OptixSiteRow[], latitude: number) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle][3] < latitude) low = middle + 1;
    else high = middle;
  }
  return low;
}

function siteFromRow(row: OptixSiteRow, index: number): Junction {
  return {
    id: `splice-site-${index}`,
    code: row[0],
    name: row[1] || `Site ${row[0]}`,
    region: row[2],
    lat: row[3],
    lon: row[4],
    documented: true,
  };
}

function formatCoordinate(point: Coordinate) {
  return `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;
}

function FiberSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="splice-color-field">
      <span>{label} *</span>
      <div>
        <i className={value === "Alb" ? "white" : ""} style={{ background: value ? colorHex[value] : "#e7e9ef" }} />
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Selectează culoarea</option>
          {fiberColors.map((color) => <option key={color}>{color}</option>)}
        </select>
      </div>
    </label>
  );
}

export function FoSplicesSection({ project: projectItem, initialSummary, onNotify, onSaved }: Props) {
  const [sites, setSites] = useState<OptixSiteRow[]>([]);
  const [sitesStatus, setSitesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(13);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<(Coordinate & { accuracy: number }) | null>(null);
  const [mode, setMode] = useState<SelectMode>("documented");
  const [creating, setCreating] = useState(false);
  const [junction, setJunction] = useState<Junction | null>(null);
  const [junctionKind, setJunctionKind] = useState<JunctionKind>("");
  const [network, setNetwork] = useState<JunctionNetwork>("");
  const [siteBuffer, setSiteBuffer] = useState("");
  const [siteFiber, setSiteFiber] = useState("");
  const [clientBuffer, setClientBuffer] = useState("");
  const [clientFiber, setClientFiber] = useState("");
  const [splicePhotos, setSplicePhotos] = useState<Partial<Record<SplicePhotoKey, string>>>({});
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<SpliceRecord[]>([]);
  const deferredSearch = useDeferredValue(search);
  useEffect(() => {
    let active = true;
    fetch("/data/optix-sites.json")
      .then((response) => {
        if (!response.ok) throw new Error("Date indisponibile");
        return response.json() as Promise<OptixPayload>;
      })
      .then((payload) => {
        if (!active) return;
        setSites(payload.sites);
        setSitesStatus("ready");
      })
      .catch(() => active && setSitesStatus("error"));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      resetDraft();
      setCreating(false);
      setRecords(initialSummary?.records ?? []);
    });
    return () => {
      active = false;
    };
  }, [projectItem.id, initialSummary]);

  const tiles = useMemo(() => {
    const projectedCenter = project(center, zoom);
    const tilesAcross = 2 ** zoom;
    const firstX = Math.floor((projectedCenter.x - MAP_WIDTH / 2) / TILE_SIZE);
    const lastX = Math.floor((projectedCenter.x + MAP_WIDTH / 2) / TILE_SIZE);
    const firstY = Math.floor((projectedCenter.y - MAP_HEIGHT / 2) / TILE_SIZE);
    const lastY = Math.floor((projectedCenter.y + MAP_HEIGHT / 2) / TILE_SIZE);
    const result: Array<{ key: string; x: number; y: number; urlX: number; urlY: number }> = [];
    for (let tileX = firstX; tileX <= lastX; tileX += 1) {
      for (let tileY = firstY; tileY <= lastY; tileY += 1) {
        if (tileY < 0 || tileY >= tilesAcross) continue;
        result.push({
          key: `${zoom}-${tileX}-${tileY}`,
          x: tileX * TILE_SIZE - (projectedCenter.x - MAP_WIDTH / 2),
          y: tileY * TILE_SIZE - (projectedCenter.y - MAP_HEIGHT / 2),
          urlX: ((tileX % tilesAcross) + tilesAcross) % tilesAcross,
          urlY: tileY,
        });
      }
    }
    return result;
  }, [center, zoom]);

  const visibleSites = useMemo(() => {
    const projectedCenter = project(center, zoom);
    const northWest = unproject({ x: projectedCenter.x - MAP_WIDTH / 2, y: projectedCenter.y - MAP_HEIGHT / 2 }, zoom);
    const southEast = unproject({ x: projectedCenter.x + MAP_WIDTH / 2, y: projectedCenter.y + MAP_HEIGHT / 2 }, zoom);
    const minimumLatitude = Math.min(northWest.lat, southEast.lat);
    const maximumLatitude = Math.max(northWest.lat, southEast.lat);
    const minimumLongitude = Math.min(northWest.lon, southEast.lon);
    const maximumLongitude = Math.max(northWest.lon, southEast.lon);
    const first = lowerLatitudeBound(sites, minimumLatitude);
    const last = lowerLatitudeBound(sites, maximumLatitude + Number.EPSILON);
    const stride = Math.max(1, Math.ceil((last - first) / 4000));
    const result: Array<{ site: Junction; point: { x: number; y: number } }> = [];
    for (let index = first; index < last; index += stride) {
      const row = sites[index];
      if (row[4] < minimumLongitude || row[4] > maximumLongitude) continue;
      const site = siteFromRow(row, index);
      const point = screenPoint(site, center, zoom);
      if (point.x > -20 && point.x < MAP_WIDTH + 20 && point.y > -20 && point.y < MAP_HEIGHT + 20) result.push({ site, point });
    }
    return result.slice(0, 140);
  }, [center, sites, zoom]);

  const searchResults = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase("ro");
    if (query.length < 2) return [];
    const matches: Junction[] = [];
    for (let index = 0; index < sites.length && matches.length < 6; index += 1) {
      const row = sites[index];
      if (`${row[0]} ${row[1]} ${row[2]}`.toLocaleLowerCase("ro").includes(query)) matches.push(siteFromRow(row, index));
    }
    return matches;
  }, [deferredSearch, sites]);

  const projectRecords = records.filter((record) => record.projectId === projectItem.id);
  const colorsReady = Boolean(siteBuffer && siteFiber && clientBuffer && clientFiber);
  const completedSplicePhotos = splicePhotoKeys.filter((key) => Boolean(splicePhotos[key])).length;
  const photosReady = completedSplicePhotos === splicePhotoKeys.length;
  const junctionReady = Boolean(junction && (junction.documented || (junctionKind && network)));

  function resetDraft() {
    setJunction(null);
    setJunctionKind("");
    setNetwork("");
    setSiteBuffer("");
    setSiteFiber("");
    setClientBuffer("");
    setClientFiber("");
    setSplicePhotos({});
    setDraftId(crypto.randomUUID());
    setSearch("");
    setMode("documented");
  }

  function startNewSplice() {
    resetDraft();
    setCreating(true);
    onNotify("Sudură nouă inițiată. Selectează joncțiunea pe hartă.");
  }

  function chooseDocumented(site: Junction) {
    if (!creating) {
      onNotify("Apasă „Sudură nouă” înainte de a selecta joncțiunea.");
      return;
    }
    setJunction(site);
    setJunctionKind("");
    setNetwork("");
    setCenter({ lat: site.lat, lon: site.lon });
    setZoom((current) => Math.max(current, 15));
    setSearch("");
  }

  function handleMapClick(event: MouseEvent<HTMLDivElement>) {
    if (!creating || mode !== "undocumented") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: project(center, zoom).x + ((event.clientX - rect.left) / rect.width) * MAP_WIDTH - MAP_WIDTH / 2,
      y: project(center, zoom).y + ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT - MAP_HEIGHT / 2,
    };
    const coordinate = unproject(point, zoom);
    setJunction({ ...coordinate, id: `undocumented-${Date.now()}`, code: "Fără cod", name: "Joncțiune nedocumentată", region: "Punct introdus pe hartă", documented: false });
    setJunctionKind("");
    setNetwork("");
  }

  function locateCurrentPosition() {
    if (!window.isSecureContext) {
      onNotify("Localizarea GPS necesită deschiderea aplicației prin conexiune securizată HTTPS.");
      return;
    }
    if (!navigator.geolocation) {
      onNotify("Localizarea GPS nu este disponibilă pe acest dispozitiv.");
      return;
    }

    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coordinate = { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy };
        setCurrentLocation(coordinate);
        setCenter(coordinate);
        setZoom(17);
        setGpsLoading(false);
        onNotify(`Locația curentă a fost identificată pe harta sudurilor · precizie ±${Math.round(coords.accuracy)} m.`);
      },
      (error) => {
        setGpsLoading(false);
        const message = error.code === 1
          ? "Accesul la locație este blocat. Permite locația din setările browserului."
          : error.code === 3
            ? "Localizarea a durat prea mult. Încearcă din nou într-o zonă cu semnal GPS."
            : "Poziția curentă nu a putut fi determinată. Încearcă din nou.";
        onNotify(message);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 },
    );
  }

  async function captureSplicePhoto(key: SplicePhotoKey, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setSplicePhotos((current) => ({ ...current, [key]: file.name }));
    try {
      const stored = await uploadProjectFile({ projectId: projectItem.id, section: "splices", category: `${draftId}:${key}`, file });
      setSplicePhotos((current) => ({ ...current, [key]: stored.name }));
    } catch (error) {
      setSplicePhotos((current) => ({ ...current, [key]: "" }));
      onNotify(error instanceof Error ? error.message : "Fotografia sudurii nu a putut fi salvată.");
    }
  }

  async function openDiagram() {
    try {
      const files = await fetchProjectFiles(projectItem.id, "project");
      const diagram = [...files].reverse().find((file) => file.category === "splice-diagram");
      if (!diagram) throw new Error("Diagrama nu a fost încărcată în stocarea permanentă.");
      window.open(diagram.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Diagrama de suduri nu a putut fi deschisă.");
    }
  }

  async function saveSplice() {
    if (!junction) {
      onNotify("Selectează joncțiunea documentată sau plasează una nedocumentată pe hartă.");
      return;
    }
    if (!junction.documented && !junctionKind) {
      onNotify("Alege dacă joncțiunea nedocumentată este existentă sau nou instalată.");
      return;
    }
    if (!junction.documented && !network) {
      onNotify("Alege rețeaua Vodafone Mobil sau Vodafone Fixed.");
      return;
    }
    if (!colorsReady) {
      onNotify("Completează culorile bufferului și firului pe ambele sensuri.");
      return;
    }
    if (!photosReady) {
      onNotify(`Mai sunt necesare ${splicePhotoKeys.length - completedSplicePhotos} fotografii obligatorii pentru această sudură.`);
      return;
    }
    const newRecord: SpliceRecord = {
      id: draftId,
      projectId: projectItem.id,
      junction,
      junctionKind,
      network,
      siteBuffer,
      siteFiber,
      clientBuffer,
      clientFiber,
      photos: {
        open: splicePhotos.open!,
        closed: splicePhotos.closed!,
        placed: splicePhotos.placed!,
      },
    };
    const nextProjectRecords = [...projectRecords, newRecord];
    const summary: SpliceFieldSummary = {
      count: nextProjectRecords.length,
      junctions: nextProjectRecords.map((record) => ({
        label: record.junction.documented ? `${record.junction.code} · ${record.junction.name}` : "Joncțiune nedocumentată",
        documented: record.junction.documented,
        kind: record.junction.documented ? "documented" : record.junctionKind as "existing" | "new",
      })),
      records: nextProjectRecords,
    };
    try {
      await onSaved?.(summary);
      setRecords(nextProjectRecords);
      setCreating(false);
      onNotify(`Sudura din ${junction.documented ? junction.code : "joncțiunea nedocumentată"} a fost salvată permanent.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Sudura nu a putut fi salvată.");
    }
  }

  return (
    <div className="page-wrap splice-page">
      <section className="page-heading client-heading">
        <div>
          <p className="eyebrow">DOCUMENTAȚIE FIBRĂ OPTICĂ</p>
          <h1>Suduri FO</h1>
          <p>Alege joncțiunea și documentează continuitatea fibrei între site și client.</p>
        </div>
        <button className="primary-button" onClick={startNewSplice}><span>＋</span> Sudură nouă</button>
      </section>

      <section className="splice-project-bar">
        <div className="splice-project-copy"><span>RID</span><div><small>PROIECT ACTIV</small><strong>{projectItem.id}</strong><p>{projectItem.client}</p></div></div>
        <div className="splice-technician"><span>{projectItem.technician.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><small>TEHNICIAN</small><strong>{projectItem.technician}</strong></div></div>
        <div className="splice-diagram">
          <span>FO</span>
          <div><small>DIAGRAMA DE SUDURI</small><strong>{projectItem.splice}</strong><p>Disponibilă tehnicianului pentru această lucrare</p></div>
          <button disabled={projectItem.splice === "Fișier neîncărcat"} onClick={() => void openDiagram()}>Deschide ↗</button>
        </div>
      </section>

      <div className="splice-layout">
        <section className="splice-map-card">
          <div className="splice-map-head">
            <div><small>SELECTARE JONCȚIUNE</small><strong>{mode === "documented" ? "Punct documentat din registru" : "Punct nedocumentat pe hartă"}</strong></div>
            <div className="splice-mode-switch">
              <button className={mode === "documented" ? "active" : ""} onClick={() => setMode("documented")}>Documentată</button>
              <button className={mode === "undocumented" ? "active" : ""} onClick={() => setMode("undocumented")}>Nedocumentată</button>
            </div>
          </div>
          <div className={`fo-map splice-map ${mode === "undocumented" ? "placing" : ""}`} onClick={handleMapClick} role="application" aria-label="Hartă OpenStreetMap pentru alegerea joncțiunii sudurii">
            <div className="fo-map-tiles" aria-hidden="true">
              {tiles.map((tile) => <img key={tile.key} src={`https://tile.openstreetmap.org/${zoom}/${tile.urlX}/${tile.urlY}.png`} alt="" draggable={false} style={{ left: `${(tile.x / MAP_WIDTH) * 100}%`, top: `${(tile.y / MAP_HEIGHT) * 100}%`, width: `${(TILE_SIZE / MAP_WIDTH) * 100}%`, height: `${(TILE_SIZE / MAP_HEIGHT) * 100}%` }} />)}
            </div>
            {visibleSites.map(({ site, point }) => (
              <button className={`fo-site-marker ${junction?.id === site.id ? "selected" : ""}`} style={{ left: `${(point.x / MAP_WIDTH) * 100}%`, top: `${(point.y / MAP_HEIGHT) * 100}%` }} key={site.id} title={`${site.code} · ${site.name}`} onClick={(event) => { event.stopPropagation(); chooseDocumented(site); }}><i /></button>
            ))}
            {junction && (() => {
              const point = screenPoint(junction, center, zoom);
              return <span className={`fo-end-marker end-b ${junction.documented ? "" : "undocumented"}`} style={{ left: `${(point.x / MAP_WIDTH) * 100}%`, top: `${(point.y / MAP_HEIGHT) * 100}%` }}><b>S</b><small>{junction.documented ? junction.code : "FĂRĂ COD"}</small></span>;
            })()}
            {currentLocation && (() => {
              const point = screenPoint(currentLocation, center, zoom);
              return <span className="splice-current-location" style={{ left: `${(point.x / MAP_WIDTH) * 100}%`, top: `${(point.y / MAP_HEIGHT) * 100}%` }}><i /><small>LOCAȚIA MEA</small></span>;
            })()}
            <div className="fo-map-instruction"><span>{mode === "documented" ? "S" : "S?"}</span>{!creating ? "Începe o sudură nouă" : mode === "documented" ? "Atinge un site documentat" : "Atinge locul joncțiunii fără cod"}</div>
            {!creating && <div className="splice-map-lock"><span>＋</span><strong>Începe cu „Sudură nouă”</strong><small>Harta devine activă pentru selectarea joncțiunii.</small></div>}
            <button
              className={`fo-locate-button splice-locate-button ${currentLocation ? "located" : ""}`}
              onClick={(event) => { event.stopPropagation(); locateCurrentPosition(); }}
              disabled={gpsLoading}
              aria-label="Identifică locația curentă pe harta sudurilor"
            >
              <span className={gpsLoading ? "loading" : ""}>{gpsLoading ? "↻" : currentLocation ? "✓" : "⌖"}</span>
              <div><strong>{gpsLoading ? "Se caută poziția…" : currentLocation ? "Locație identificată" : "Locația mea"}</strong><small>{currentLocation ? `Precizie ±${Math.round(currentLocation.accuracy)} m` : "Centrează harta sudurilor"}</small></div>
            </button>
            <div className="fo-zoom" onClick={(event) => event.stopPropagation()}><button onClick={() => setZoom((current) => clamp(current + 1, 7, 18))}>＋</button><button onClick={() => setZoom((current) => clamp(current - 1, 7, 18))}>−</button></div>
            <a className="fo-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>© OpenStreetMap contributors</a>
          </div>
          <div className="splice-map-search">
            <label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Caută după cod, nume sau localitate…" disabled={!creating} /></label>
            <div className={`splice-data-state ${sitesStatus}`}><i>{sitesStatus === "ready" ? "✓" : sitesStatus === "error" ? "!" : "↻"}</i>{sitesStatus === "ready" ? `${sites.length.toLocaleString("ro-RO")} site-uri` : sitesStatus === "error" ? "Date indisponibile" : "Se încarcă"}</div>
            {search.trim().length >= 2 && <div className="splice-search-results">{searchResults.map((site) => <button key={site.id} onClick={() => chooseDocumented(site)}><span>{site.code}</span><div><strong>{site.name}</strong><small>{site.region}</small></div><b>→</b></button>)}{!searchResults.length && <p>Niciun site găsit.</p>}</div>}
          </div>
        </section>

        <aside className="splice-side">
          {!creating ? (
            <section className="splice-empty-card"><span>SU</span><h2>Nicio sudură în editare</h2><p>Pornește o înregistrare nouă, apoi selectează joncțiunea și fibrele sudate.</p><button onClick={startNewSplice}>＋ Sudură nouă</button></section>
          ) : (
            <>
              <section className="splice-form-card">
                <div className="splice-card-title"><span>1</span><div><h2>Joncțiunea în care se execută sudura</h2><p>Documentată în registru sau introdusă manual.</p></div></div>
                <div className={`splice-junction-result ${junction ? "selected" : ""}`}><span>{junction ? "✓" : "○"}</span><div><small>PUNCT SELECTAT</small><strong>{junction ? `${junction.code} · ${junction.name}` : "Alege punctul pe hartă"}</strong><p>{junction ? `${junction.region} · ${formatCoordinate(junction)}` : "Folosește harta sau căutarea după site."}</p></div></div>
                {junction?.documented === false && <div className="splice-undocumented-fields">
                  <fieldset><legend>SITUAȚIE ÎN TEREN *</legend><div>{(["existing", "new"] as const).map((kind) => <label className={junctionKind === kind ? "selected" : ""} key={kind}><input type="radio" name="splice-junction-kind" checked={junctionKind === kind} onChange={() => setJunctionKind(kind)} /><span>{kind === "existing" ? "EX" : "NOU"}</span><p><strong>{kind === "existing" ? "Joncțiune existentă" : "Joncțiune nou instalată"}</strong><small>{kind === "existing" ? "Prezentă deja în teren" : "Instalată în acest proiect"}</small></p><i /></label>)}</div></fieldset>
                  <fieldset><legend>REȚEA VODAFONE *</legend><div>{(["mobile", "fixed"] as const).map((item) => <label className={network === item ? "selected" : ""} key={item}><input type="radio" name="splice-network" checked={network === item} onChange={() => setNetwork(item)} /><span>{item === "mobile" ? "MOB" : "FIX"}</span><p><strong>{item === "mobile" ? "Vodafone Mobil" : "Vodafone Fixed"}</strong><small>Rețeaua joncțiunii</small></p><i /></label>)}</div></fieldset>
                </div>}
              </section>

              <section className="splice-form-card">
                <div className="splice-card-title"><span>2</span><div><h2>Fibre sudate</h2><p>Completează perechea pe fiecare sens.</p></div></div>
                <div className="splice-directions">
                  <article><div className="splice-direction-title"><span>→</span><div><small>SENS 1</small><strong>Spre site</strong></div></div><div className="splice-color-grid"><FiberSelect label="Culoare buffer" value={siteBuffer} onChange={setSiteBuffer} /><FiberSelect label="Culoare fir" value={siteFiber} onChange={setSiteFiber} /></div></article>
                  <div className="splice-fusion"><i /><span>SUDURĂ</span><i /></div>
                  <article><div className="splice-direction-title client"><span>→</span><div><small>SENS 2</small><strong>Spre client</strong></div></div><div className="splice-color-grid"><FiberSelect label="Culoare buffer" value={clientBuffer} onChange={setClientBuffer} /><FiberSelect label="Culoare fir" value={clientFiber} onChange={setClientFiber} /></div></article>
                </div>
              </section>

              <section className="splice-form-card splice-photo-section">
                <div className="splice-card-title"><span>3</span><div><h2>Fotografii obligatorii</h2><p>{completedSplicePhotos}/3 cadre încărcate pentru această sudură.</p></div></div>
                <div className="splice-photo-grid">
                  {splicePhotoKeys.map((key) => {
                    const item = splicePhotoCatalog[key];
                    const photoName = splicePhotos[key];
                    return (
                      <label className={photoName ? "complete" : ""} key={key}>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(event) => void captureSplicePhoto(key, event.target.files)}
                        />
                        <span>{photoName ? "✓" : item.badge}</span>
                        <div><strong>{item.title}</strong><small>{photoName || item.description}</small></div>
                        <b>{photoName ? "Schimbă" : "Adaugă"}</b>
                      </label>
                    );
                  })}
                </div>
                <div className="splice-readiness"><span className={junctionReady && colorsReady && photosReady ? "ready" : ""}>{junctionReady && colorsReady && photosReady ? "✓" : "i"}</span><p><strong>{junctionReady && colorsReady && photosReady ? "Sudură pregătită pentru salvare" : !junction ? "Selectează joncțiunea" : !junctionReady ? "Completează clasificarea joncțiunii" : !colorsReady ? "Completează toate culorile" : "Încarcă cele 3 fotografii obligatorii"}</strong><small>Datele obligatorii sunt marcate cu *.</small></p></div>
                <div className="splice-form-actions"><button onClick={() => { resetDraft(); setCreating(false); }}>Renunță</button><button className="primary-button" onClick={saveSplice}>Salvează sudura <span>→</span></button></div>
              </section>
            </>
          )}

          <section className="splice-records-card">
            <div className="splice-card-title"><span>✓</span><div><h2>Suduri documentate</h2><p>{projectItem.id} · {projectRecords.length} înregistrări</p></div></div>
            {projectRecords.length ? <div className="splice-record-list">{projectRecords.map((record, index) => <article key={record.id}><span>{index + 1}</span><div><strong>{record.junction.documented ? `${record.junction.code} · ${record.junction.name}` : `Fără cod · ${record.junctionKind === "existing" ? "existentă" : "nou instalată"}`}</strong><small>{record.junction.documented ? "Joncțiune documentată" : record.network === "mobile" ? "Vodafone Mobil" : "Vodafone Fixed"} · 3 fotografii</small><p><b style={{ background: colorHex[record.siteBuffer] }} />{record.siteBuffer}/{record.siteFiber} <i>→</i> <b style={{ background: colorHex[record.clientBuffer] }} />{record.clientBuffer}/{record.clientFiber}</p></div><em>Salvată</em></article>)}</div> : <div className="splice-no-records"><span>○</span><p>Nicio sudură salvată pentru această lucrare.</p></div>}
          </section>
        </aside>
      </div>
    </div>
  );
}
