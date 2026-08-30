"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProjectFieldDocumentation, RouteMethod } from "./field-documentation";

type DocumentProject = {
  id: string;
  client: string;
  address: string;
  cpe: string;
  sfp: boolean;
  mc: boolean;
  terminalBox: boolean;
  splice: string;
};

type ReportDraft = {
  title: string;
  siteLabel: string;
  site: string;
  route: string;
  client: string;
};

type BudgetSuggestion = {
  id: string;
  category: "Manoperă" | "Material";
  catalogPosition: string;
  name: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  evidence: string;
  selected: boolean;
};

type Props = {
  project: DocumentProject;
  fieldData: ProjectFieldDocumentation;
  onNotify: (message: string) => void;
};

const routeCatalog: Record<Exclude<RouteMethod, "aerial">, { position: string; name: string; unit: string; price: number }> = {
  duct: { position: "22", name: "Instalare cablu FO în monotub sau canalizație existentă", unit: "km", price: 323 },
  tray: { position: "15", name: "Instalare cablu comunicații prin pat de cablu", unit: "km", price: 480 },
  facade: { position: "10", name: "Pozat FO ADSS pe fațade de clădiri", unit: "km", price: 430 },
};

const materialCatalog = {
  boat: { position: "M2", name: "Accesoriu instalare cablu FO ADSS «Bărcuță»", price: 0.53 },
  stainlessClamp: { position: "M3", name: "Accesoriu instalare cablu FO ADSS «Colier tablă inox»", price: 0.39 },
  hook: { position: "M4", name: "Accesoriu instalare cablu FO ADSS «Cârlig»", price: 0.31 },
  armorod: { position: "M5", name: "Accesoriu instalare cablu FO ADSS «Armorod»", price: 5.69 },
};

function formatNumber(value: number) {
  return value.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function asBullets(lines: string[]) {
  return lines.map((line) => `–  ${line}`).join("\n");
}

function inferSiteLabel(project: DocumentProject, fieldData: ProjectFieldDocumentation) {
  const source = `${fieldData.site?.odf ?? ""} ${fieldData.site?.etn ?? ""}`;
  const siteCode = source.match(/(?:^|[-_\s])([a-z]\d{3,})(?:$|[-_\s])/i)?.[1];
  return siteCode ? `Site ${siteCode.toUpperCase()}` : `Site ${project.id}`;
}

function getRouteCatalogItem(method: RouteMethod, cableType: string) {
  if (method !== "aerial") return routeCatalog[method];
  const fiberCount = Number(cableType.match(/(\d+)\s*(?:fire|fibre)/i)?.[1] ?? 0);
  if (fiberCount >= 144) return { position: "13", name: "Instalare FO ADSS 144 fire pe stâlpi", unit: "km", price: 380 };
  if (fiberCount >= 24) return { position: "12", name: "Instalare FO ADSS 24, 48 sau 96 fire pe stâlpi", unit: "km", price: 380 };
  return { position: "11", name: "Instalare FO ADSS 2, 4, 8 sau 12 fire pe stâlpi", unit: "km", price: 380 };
}

function buildReport(project: DocumentProject, fieldData: ProjectFieldDocumentation): ReportDraft {
  const siteLines = fieldData.site?.noIntervention
    ? [`Nu s-a intervenit în secțiunea Site. Motiv: ${fieldData.site.noInterventionReason}.`]
    : fieldData.site
    ? [
        `S-a cablat portul ${fieldData.site.etnPort} din switch ${fieldData.site.etn}.`,
        `Conexiunea a fost realizată în ODF ${fieldData.site.odf}, portul ${fieldData.site.odfPort}.`,
      ]
    : ["Datele pentru ODF și eTN nu au fost încă salvate din teren."];

  const routeLines = fieldData.route?.noIntervention
    ? [`Nu s-a intervenit la traseul FO. Motiv: ${fieldData.route.noInterventionReason}.`]
    : fieldData.route?.segments.length
    ? [
        `S-a instalat un traseu FO între ${fieldData.route.junction.label} și locația clientului, în lungime de ${fieldData.route.totalLengthMeters.toLocaleString("ro-RO")} m, din care ${fieldData.route.segments.map((segment) => `${segment.lengthMeters.toLocaleString("ro-RO")} m ${segment.label.toLocaleLowerCase("ro-RO")}`).join(", ")}.`,
        `Tipuri de cablu utilizate: ${fieldData.route.segments.map((segment) => `${segment.cableType} (${segment.label.toLocaleLowerCase("ro-RO")})`).join(", ")}.`,
      ]
    : ["Traseul FO nu a fost încă salvat din teren."];

  if (fieldData.splices?.noIntervention) {
    routeLines.push(`Nu s-a intervenit la sudurile FO. Motiv: ${fieldData.splices.noInterventionReason}.`);
  } else if (fieldData.splices?.count) {
    const junctions = [...new Set(fieldData.splices.junctions.map((junction) => junction.label))].join(", ");
    routeLines.push(`S-au executat ${fieldData.splices.count} ${fieldData.splices.count === 1 ? "sudură FO" : "suduri FO"}${junctions ? ` în ${junctions}` : ""}.`);
  }

  const equipment = fieldData.client?.equipment ?? [
    project.cpe,
    ...(project.sfp ? ["SFP optic"] : []),
    ...(project.mc ? ["Media Converter"] : []),
    ...(project.terminalBox ? ["Terminal Box"] : []),
  ];
  const clientLines = fieldData.client?.noIntervention
    ? [`Nu s-a intervenit la client. Motiv: ${fieldData.client.noInterventionReason}.`]
    : [
        `S-a instalat și configurat echipamentul ${equipment[0] || project.cpe}.`,
        ...equipment.slice(1).map((item) => `S-a instalat ${item}.`),
      ];
  if (fieldData.client?.service) clientLines.push(`Serviciul documentat: ${fieldData.client.service}.`);
  if (fieldData.client?.clientHasNoGroundingSystem) {
    clientLines.push("Clientul declară că locația nu dispune de sistem de împământare, iar echipamentul nu a putut fi conectat la împământare.");
  }

  return {
    title: "Raport acceptanță",
    siteLabel: inferSiteLabel(project, fieldData),
    site: asBullets(siteLines),
    route: asBullets(routeLines),
    client: asBullets(clientLines),
  };
}

function buildBudgetSuggestions(fieldData: ProjectFieldDocumentation): BudgetSuggestion[] {
  const suggestions: BudgetSuggestion[] = [];

  for (const segment of fieldData.route?.segments ?? []) {
    const item = getRouteCatalogItem(segment.method, segment.cableType);
    suggestions.push({
      id: `route-${segment.method}`,
      category: "Manoperă",
      catalogPosition: item.position,
      name: item.name,
      unit: item.unit,
      unitPrice: item.price,
      quantity: Number((segment.lengthMeters / 1000).toFixed(3)),
      evidence: `${segment.label} · ${segment.lengthMeters.toLocaleString("ro-RO")} m documentați`,
      selected: true,
    });
  }

  if (fieldData.splices?.count) {
    suggestions.push({
      id: "splice-work",
      category: "Manoperă",
      catalogPosition: "7",
      name: "Sudură fibră optică",
      unit: "buc",
      unitPrice: 4,
      quantity: fieldData.splices.count,
      evidence: `${fieldData.splices.count} ${fieldData.splices.count === 1 ? "sudură salvată" : "suduri salvate"} în secțiunea Suduri FO`,
      selected: true,
    });
    suggestions.push({
      id: "junction-open-close",
      category: "Manoperă",
      catalogPosition: "8",
      name: "Închidere/deschidere cutie de joncțiune/ODF",
      unit: "luc",
      unitPrice: 11.9,
      quantity: Math.max(1, new Set(fieldData.splices.junctions.map((junction) => junction.label)).size),
      evidence: "Joncțiuni deschise, închise și fotografiate în teren",
      selected: true,
    });
  }

  const materials = fieldData.route?.aerialMaterials;
  if (materials) {
    for (const key of Object.keys(materialCatalog) as Array<keyof typeof materialCatalog>) {
      if (!materials[key]) continue;
      const item = materialCatalog[key];
      suggestions.push({
        id: `material-${key}`,
        category: "Material",
        catalogPosition: item.position,
        name: item.name,
        unit: "buc",
        unitPrice: item.price,
        quantity: materials[key],
        evidence: `${materials[key]} buc. declarate la instalarea aeriană`,
        selected: true,
      });
    }
  }

  const newJunctions = Math.max(
    fieldData.route?.junction.kind === "new" ? 1 : 0,
    fieldData.splices?.junctions.filter((junction) => junction.kind === "new").length ?? 0
  );
  if (newJunctions) {
    suggestions.push({
      id: "new-junction-box",
      category: "Material",
      catalogPosition: "M6",
      name: "Furnizare cutie de joncțiune FO ADSS, 12 joncțiuni",
      unit: "buc",
      unitPrice: 63,
      quantity: newJunctions,
      evidence: `${newJunctions} ${newJunctions === 1 ? "joncțiune nou instalată" : "joncțiuni nou instalate"}`,
      selected: true,
    });
  }

  return suggestions;
}

export function ProjectDocumentsSection({ project, fieldData, onNotify }: Props) {
  const [tab, setTab] = useState<"report" | "splices" | "estimate">("report");
  const [report, setReport] = useState(() => buildReport(project, fieldData));
  const [suggestions, setSuggestions] = useState(() => buildBudgetSuggestions(fieldData));
  const [savedAt, setSavedAt] = useState("");

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setReport(buildReport(project, fieldData));
      setSuggestions(buildBudgetSuggestions(fieldData));
      setSavedAt("");
    });
    fetch(`/api/reports?${new URLSearchParams({ projectId: project.id }).toString()}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { saved?: { report: ReportDraft; updatedAt: number } | null; error?: string };
        if (!response.ok) throw new Error(payload.error || "Raportul nu este disponibil momentan.");
        if (!active || !payload.saved) return;
        setReport(payload.saved.report);
        setSavedAt(new Intl.DateTimeFormat("ro-RO", { hour: "2-digit", minute: "2-digit" }).format(new Date(payload.saved.updatedAt)));
      })
      .catch(() => {
        // The generated report remains editable while a saved version is temporarily unavailable.
      });
    return () => {
      active = false;
    };
  }, [project.id, fieldData]);

  const selectedSuggestions = suggestions.filter((item) => item.selected);
  const estimateTotal = useMemo(
    () => selectedSuggestions.reduce((total, item) => total + item.quantity * item.unitPrice, 0),
    [selectedSuggestions]
  );

  function updateReport(field: keyof ReportDraft, value: string) {
    setReport((current) => ({ ...current, [field]: value }));
  }

  function regenerate() {
    setReport(buildReport(project, fieldData));
    onNotify("Raportul a fost regenerat din operațiunile salvate în teren.");
  }

  async function saveReport() {
    try {
      const response = await fetch("/api/reports", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, report }),
      });
      const payload = (await response.json()) as { updatedAt?: number; error?: string };
      if (!response.ok || !payload.updatedAt) throw new Error(payload.error || "Raportul nu a putut fi salvat.");
      setSavedAt(new Intl.DateTimeFormat("ro-RO", { hour: "2-digit", minute: "2-digit" }).format(new Date(payload.updatedAt)));
      onNotify(`Raportul de acceptanță pentru ${project.id} a fost salvat permanent.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Raportul de acceptanță nu a putut fi salvat.");
    }
  }

  function updateSuggestion(id: string, patch: Partial<BudgetSuggestion>) {
    setSuggestions((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  return (
    <div className="page-wrap project-documents-page">
      <section className="page-heading documents-heading">
        <div><p className="eyebrow">CONTROL ȘI ÎNCHIDERE PROIECT</p><h1>Documente</h1><p>Pregătește raportul de acceptanță și devizul pe baza datelor documentate în teren.</p></div>
        <div className="manager-access-badge"><span>◆</span><div><small>ACCES RESTRICȚIONAT</small><strong>Admin / Manager / Coordonator</strong></div></div>
      </section>

      <div className="documents-tabs" role="tablist" aria-label="Subsecțiuni documente">
        <button className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}><span>DOC</span><div><strong>Raport de acceptanță</strong><small>Previzualizare și editare</small></div></button>
        <button className={tab === "splices" ? "active" : ""} onClick={() => setTab("splices")}><span>FO</span><div><strong>Fișă de suduri</strong><small>Corespondență fibre</small></div><b>{fieldData.splices?.records?.length ?? 0}</b></button>
        <button className={tab === "estimate" ? "active" : ""} onClick={() => setTab("estimate")}><span>EUR</span><div><strong>Sugestii deviz</strong><small>Operațiuni și materiale</small></div><b>{suggestions.length}</b></button>
      </div>

      {tab === "report" && (
        <div className="report-workspace">
          <section className="acceptance-preview-card">
            <div className="document-toolbar"><div><span>W</span><p><strong>Raport acceptanță · {project.id}</strong><small>Model: Raport acceptanta.docx</small></p></div><div><button onClick={regenerate}>↻ Generează din teren</button><button className="primary-button" onClick={saveReport}>Salvează</button></div></div>
            <article className="acceptance-paper">
              <input className="report-title-input" value={report.title} onChange={(event) => updateReport("title", event.target.value)} aria-label="Titlul raportului" />
              <input className="report-site-input" value={report.siteLabel} onChange={(event) => updateReport("siteLabel", event.target.value)} aria-label="Identificator proiect sau site" />
              <section className="editable-report-section site-report-section">
                <textarea value={report.site} onChange={(event) => updateReport("site", event.target.value)} rows={Math.max(2, report.site.split("\n").length + 1)} aria-label="Conținut secțiune Site" />
                <small>Fiecare rând este inclus ca punct distinct în raport.</small>
              </section>
              {(["route", "client"] as const).map((section) => (
                <section className="editable-report-section" key={section}>
                  <h2>{section === "route" ? "Traseu" : "Client"}</h2>
                  <textarea value={report[section]} onChange={(event) => updateReport(section, event.target.value)} rows={Math.max(2, report[section].split("\n").length + 1)} aria-label={`Conținut secțiune ${section}`} />
                  <small>Fiecare rând este inclus ca punct distinct în raport.</small>
                </section>
              ))}
            </article>
          </section>

          <aside className="report-status-card">
            <div className="summary-title"><span>DOC</span><div><h2>Stare raport</h2><p>{project.id} · {project.client}</p></div></div>
            <div className="report-source-list">
              <div className={fieldData.site ? "complete" : ""}><span>{fieldData.site ? "✓" : "○"}</span><p><strong>Operațiuni site</strong><small>{fieldData.site ? fieldData.site.noIntervention ? "Nu s-a intervenit" : "ODF și eTN preluate" : "Date nesalvate"}</small></p></div>
              <div className={fieldData.route ? "complete" : ""}><span>{fieldData.route ? "✓" : "○"}</span><p><strong>Traseu FO</strong><small>{fieldData.route ? fieldData.route.noIntervention ? "Nu s-a intervenit" : `${fieldData.route.totalLengthMeters} m preluați` : "Date nesalvate"}</small></p></div>
              <div className={fieldData.splices ? "complete" : ""}><span>{fieldData.splices ? "✓" : "○"}</span><p><strong>Suduri FO</strong><small>{fieldData.splices ? fieldData.splices.noIntervention ? "Nu s-a intervenit" : `${fieldData.splices.count} înregistrări` : "Date nesalvate"}</small></p></div>
              <div className={fieldData.client ? "complete" : ""}><span>{fieldData.client ? "✓" : "○"}</span><p><strong>Client</strong><small>{fieldData.client ? fieldData.client.noIntervention ? `Nu s-a intervenit · ${fieldData.client.service}` : fieldData.client.service : "Date nesalvate"}</small></p></div>
            </div>
            <div className="report-save-state"><span>{savedAt ? "✓" : "i"}</span><p><strong>{savedAt ? `Versiune salvată la ${savedAt}` : "Raport editabil"}</strong><small>Modificările administratorului nu schimbă datele tehnicianului.</small></p></div>
            <button className="secondary-button report-export" onClick={() => onNotify("Raportul va fi exportat în format DOCX după confirmarea administratorului.")}>Exportă DOCX <span>↗</span></button>
          </aside>
        </div>
      )}

      {tab === "splices" && (
        <section className="splice-sheet-card">
          <div className="document-toolbar splice-sheet-toolbar">
            <div><span>FO</span><p><strong>Fișă de suduri · {project.id}</strong><small>Generată din înregistrările salvate în teren</small></p></div>
            <div><button className="primary-button" onClick={() => window.print()}>Tipărește / Salvează PDF</button></div>
          </div>
          <article className="splice-sheet-paper">
            <header>
              <div><small>PRO CONECT</small><h1>Fișă de suduri fibră optică</h1></div>
              <strong>{project.id}</strong>
            </header>
            <div className="splice-sheet-project">
              <div><small>CLIENT</small><strong>{project.client}</strong></div>
              <div><small>LOCAȚIE</small><strong>{project.address}</strong></div>
              <div><small>DIAGRAMĂ DE REFERINȚĂ</small><strong>{project.splice || "Neîncărcată"}</strong></div>
              <div><small>TOTAL SUDURI</small><strong>{fieldData.splices?.count ?? 0}</strong></div>
            </div>
            {fieldData.splices?.noIntervention ? (
              <div className="splice-sheet-empty"><strong>Nu s-a intervenit la sudurile FO</strong><p>{fieldData.splices.noInterventionReason}</p></div>
            ) : fieldData.splices?.records?.length ? (
              <div className="splice-sheet-table-wrap">
                <table className="splice-sheet-table">
                  <thead><tr><th>NR.</th><th>JONCȚIUNE</th><th>TIP / REȚEA</th><th>TUB SITE</th><th>FIBRĂ SITE</th><th>TUB CLIENT</th><th>FIBRĂ CLIENT</th></tr></thead>
                  <tbody>{fieldData.splices.records.map((record, index) => (
                    <tr key={record.id}>
                      <td>{index + 1}</td>
                      <td><strong>{record.junction.documented ? record.junction.code : "Fără cod"}</strong><small>{record.junction.name}</small></td>
                      <td><strong>{record.junction.documented ? "Documentată" : record.junctionKind === "new" ? "Nouă" : "Existentă"}</strong><small>{record.network === "mobile" ? "Vodafone Mobil" : record.network === "fixed" ? "Vodafone Fixed" : "—"}</small></td>
                      <td>{record.siteBuffer}</td>
                      <td>{record.siteFiber}</td>
                      <td>{record.clientBuffer}</td>
                      <td>{record.clientFiber}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <div className="splice-sheet-empty"><strong>Nu există suduri salvate</strong><p>Completează secțiunea „Suduri FO” pentru a genera fișa.</p></div>
            )}
            <footer><span>{project.id} · {project.client}</span><span>Fișă generată din datele documentate în aplicație</span></footer>
          </article>
        </section>
      )}

      {tab === "estimate" && (
        <section className="estimate-card">
          <div className="estimate-head"><div><span>Σ</span><p><small>MODEL DEVIZ</small><strong>Deviz final · sugestii automate</strong><em>Prețurile sunt preluate din fișierul atașat; cantitățile provin din teren.</em></p></div><div><small>TOTAL SELECTAT, FĂRĂ TVA</small><strong>{formatNumber(estimateTotal)} EUR</strong></div></div>
          {suggestions.length ? (
            <div className="estimate-table-wrap">
              <table className="estimate-table">
                <thead><tr><th>INCLUDE</th><th>POZ.</th><th>LUCRARE / MATERIAL</th><th>UM</th><th>PREȚ EUR</th><th>CANTITATE</th><th>TOTAL EUR</th></tr></thead>
                <tbody>{suggestions.map((item) => (
                  <tr className={item.selected ? "selected" : ""} key={item.id}>
                    <td><input type="checkbox" checked={item.selected} onChange={(event) => updateSuggestion(item.id, { selected: event.target.checked })} aria-label={`Include ${item.name}`} /></td>
                    <td><span className={item.category === "Material" ? "estimate-position material" : "estimate-position"}>{item.catalogPosition}</span></td>
                    <td><strong>{item.name}</strong><small>{item.evidence}</small></td>
                    <td>{item.unit}</td>
                    <td>{formatNumber(item.unitPrice)}</td>
                    <td><input type="number" min="0" step="0.001" value={item.quantity} onChange={(event) => updateSuggestion(item.id, { quantity: Number(event.target.value) })} /></td>
                    <td><strong>{formatNumber(item.quantity * item.unitPrice)}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : (
            <div className="estimate-empty"><span>○</span><h2>Nicio sugestie disponibilă</h2><p>Salvează traseul, sudurile sau materialele utilizate pentru a genera pozițiile de deviz.</p></div>
          )}
          <div className="estimate-footer"><p><span>i</span><strong>Verificare administrator</strong> Sugestiile nu modifică devizul până la confirmare.</p><div><button className="secondary-button" onClick={() => onNotify("Modelul Deviz final RID1750308.xls este disponibil pentru consultare.")}>Vezi modelul</button><button className="primary-button" disabled={!selectedSuggestions.length} onClick={() => onNotify(`${selectedSuggestions.length} poziții au fost pregătite pentru devizul ${project.id}.`)}>Aplică în deviz <span>→</span></button></div></div>
        </section>
      )}
    </div>
  );
}
