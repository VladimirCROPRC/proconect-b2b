"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProjectFieldDocumentation } from "./field-documentation";
import { boqCatalog } from "./boq-catalog";
import { buildBudgetSuggestions, catalogSuggestion, budgetReady, reconcileBudget, normalizeBudget, type BudgetSuggestion } from "./project-budget";
import "./project-budget.css";

type DocumentProject = {
  id: string;
  client: string;
  address: string;
  cpe: string;
  sfp: boolean;
  mc: boolean;
  terminalBox: boolean;
  activityType?: string;
};

type ReportDraft = {
  title: string;
  siteLabel: string;
  site: string;
  route: string;
  client: string;
};

type Props = {
  project: DocumentProject;
  fieldData: ProjectFieldDocumentation;
  onNotify: (message: string) => void;
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

export function ProjectDocumentsSection({ project, fieldData, onNotify }: Props) {
  const [tab, setTab] = useState<"report" | "estimate">(project.activityType === "Intervenție" ? "estimate" : "report");
  const [report, setReport] = useState(() => buildReport(project, fieldData));
  const [suggestions, setSuggestions] = useState(() => buildBudgetSuggestions(fieldData));
  const generatedBudget = useMemo(() => buildBudgetSuggestions(fieldData), [fieldData]);
  const [savedAt, setSavedAt] = useState("");
  const [estimateState, setEstimateState] = useState("Se încarcă devizul…");
  const [estimateLoaded, setEstimateLoaded] = useState(false);
  const [savingEstimate, setSavingEstimate] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setReport(buildReport(project, fieldData));
      setSuggestions(buildBudgetSuggestions(fieldData));
      setSavedAt("");
      setEstimateLoaded(false);
      setEstimateState("Se încarcă devizul…");
    });
    fetch(`/api/estimates?${new URLSearchParams({ projectId: project.id })}`, { credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        const payload = await response.json() as { saved?: { rows: BudgetSuggestion[] }; error?: string };
        if (!response.ok) throw new Error(payload.error || "Devizul nu a putut fi încărcat.");
        if (!active) return;
        const saved = payload.saved ? normalizeBudget(payload.saved.rows) : [];
        if (!saved) throw new Error("Devizul salvat necesită verificare.");
        setSuggestions(reconcileBudget(buildBudgetSuggestions(fieldData), saved));
        setEstimateLoaded(true);
        setEstimateState(payload.saved ? "Deviz încărcat; verifică acțiunile și salvează actualizările." : "Deviz generat din teren, nesalvat.");
      })
      .catch(error => { if (active) setEstimateState(error instanceof Error ? error.message : "Deviz indisponibil."); });
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
  }, [project, fieldData]);

  const selectedSuggestions = suggestions.filter((item) => item.selected);
  const estimateTotal = useMemo(
    () => selectedSuggestions.reduce((total, item) => total + Math.round(item.quantity * item.unitPrice * 100), 0) / 100,
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
    setEstimateState("Modificări nesalvate.");
  }

  function catalogOptions(row: BudgetSuggestion) {
    const expected = generatedBudget.find(item => item.id === row.id);
    const fixedAccess = expected?.id.startsWith("closure-") && ["102", "103"].includes(expected.catalogPosition);
    return boqCatalog.filter(item => item.row !== 109 && (!fixedAccess || String(item.row) === expected?.catalogPosition));
  }

  function selectCatalog(id: string, value: string) {
    setSuggestions(current => current.map(item => item.id !== id ? item : value === "included"
      ? { ...item, catalogPosition: value, unitPrice: 0, unit: "buc" }
      : { ...catalogSuggestion(id, Number(value), item.quantity, item.evidence, item.name), note: item.note }));
    setEstimateState("Modificări nesalvate.");
  }

  async function saveEstimate() {
    if (!estimateLoaded || savingEstimate || !budgetReady(suggestions)) return;
    setSavingEstimate(true);
    try {
      const response = await fetch("/api/estimates", {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, rows: suggestions, source: JSON.stringify(buildBudgetSuggestions(fieldData)) }),
      });
      const payload = await response.json() as { rows?: BudgetSuggestion[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Devizul nu a putut fi salvat.");
      if (payload.rows) setSuggestions(payload.rows);
      setEstimateState("Deviz salvat permanent.");
      onNotify(`Devizul pentru ${project.id} a fost salvat.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Devizul nu a putut fi salvat.");
    } finally { setSavingEstimate(false); }
  }

  function exportEstimate() {
    if (!budgetReady(suggestions)) return;
    // Escape formula-leading text before opening the UTF-8 CSV in Excel.
    const cell = (value: string | number) => {
      const text = String(value);
      return '"' + (typeof value === "string" && /^[=+@\-\t\r\n]/.test(text) ? "'" : "") + text.replaceAll('"', '""') + '"';
    };
    const lines = [["RID", "Rând BoQ", "Lucrare / material", "UM", "Cantitate", "Preț EUR", "Total EUR fără TVA", "Documentare", "Observații"],
      ...suggestions.map(item => [project.id, item.catalogPosition, item.name, item.unit, item.quantity, item.unitPrice, Math.round(item.quantity * item.unitPrice * 100) / 100, item.evidence, item.note ?? ""]),
      [project.id, "", "TOTAL EUR FĂRĂ TVA", "", "", "", estimateTotal, "", ""]];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + lines.map(row => row.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `Deviz-${project.id.replace(/[^a-z0-9_-]/gi, "_")}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="page-wrap project-documents-page">
      <section className="page-heading documents-heading">
        <div><p className="eyebrow">CONTROL ȘI ÎNCHIDERE PROIECT</p><h1>Documente</h1><p>Pregătește raportul de acceptanță și devizul pe baza datelor documentate în teren.</p></div>
        <div className="manager-access-badge"><span>◆</span><div><small>ACCES RESTRICȚIONAT</small><strong>Admin / Manager / Coordonator</strong></div></div>
      </section>

      <div className="documents-tabs" role="tablist" aria-label="Subsecțiuni documente">
        {project.activityType !== "Intervenție" && <button className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}><span>DOC</span><div><strong>Raport de acceptanță</strong><small>Previzualizare și editare</small></div></button>}
        <button className={tab === "estimate" ? "active" : ""} onClick={() => setTab("estimate")}><span>EUR</span><div><strong>Deviz</strong><small>Toate acțiunile documentate</small></div><b>{suggestions.length}</b></button>
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

      {tab === "estimate" && (
        <section className="estimate-card">
          <div className="estimate-head"><div><span>Σ</span><p><small>BoQ VBTS FO PRC</small><strong>Deviz din acțiunile executate</strong><em>Diametru implicit cablu ≤10 mm. Pozițiile sunt rândurile din foaia VBTS Fibre Build.</em><em role="status">{estimateState} {!budgetReady(suggestions) && "Completează pozițiile și cantitățile lipsă."}</em></p></div><div><small>{budgetReady(suggestions) ? "TOTAL FĂRĂ TVA" : "TOTAL PARȚIAL, FĂRĂ TVA"}</small><strong>{formatNumber(estimateTotal)} EUR</strong></div></div>
          {suggestions.length ? (
            <div className="estimate-table-wrap">
              <table className="estimate-table">
                <thead><tr><th>ACȚIUNE</th><th>RÂND BoQ</th><th>LUCRARE / MATERIAL</th><th>UM</th><th>PREȚ EUR</th><th>CANTITATE</th><th>TOTAL EUR</th></tr></thead>
                <tbody>{suggestions.map((item) => (
                  <tr className={item.selected ? "selected" : ""} key={item.id}>
                    <td>{item.id.startsWith("manual-") ? <button disabled={!estimateLoaded || savingEstimate} onClick={() => { setSuggestions(current => current.filter(row => row.id !== item.id)); setEstimateState("Modificări nesalvate."); }} aria-label={`Șterge poziția manuală ${item.name}`}>Șterge</button> : "Din teren"}</td>
                    <td><select aria-label={`Poziție BoQ: ${item.name}`} disabled={!estimateLoaded || savingEstimate || item.id === "site-patch"} value={item.catalogPosition} onChange={event => selectCatalog(item.id, event.target.value)}><option value="">Alege poziția</option><option value="included">Inclus / beneficiar (0 EUR)</option>{catalogOptions(item).map(entry => <option key={entry.row} value={entry.row}>{entry.row} · {entry.name}</option>)}</select></td>
                    <td><strong>{item.id === "site-patch" ? item.name : item.catalogPosition === "included" ? "Inclus / furnizat de beneficiar" : item.name}</strong><small>{item.evidence}</small><input aria-label={`Observații: ${item.name}`} placeholder={item.catalogPosition === "included" ? "Justificare obligatorie / poziția care include lucrarea" : "Observații"} maxLength={2000} value={item.note ?? ""} disabled={!estimateLoaded || savingEstimate} onChange={event => updateSuggestion(item.id, { note: event.target.value })} /></td>
                    <td>{item.unit}</td>
                    <td>{item.unitPrice.toLocaleString("ro-RO", { maximumFractionDigits: 5 })}</td>
                    <td><input aria-label={`Cantitate: ${item.name}`} disabled={!estimateLoaded || savingEstimate} type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateSuggestion(item.id, { quantity: Number(event.target.value) })} /></td>
                    <td><strong>{formatNumber(item.quantity * item.unitPrice)}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : (
            <div className="estimate-empty"><span>○</span><h2>Nicio sugestie disponibilă</h2><p>Salvează traseul, sudurile sau materialele utilizate pentru a genera pozițiile de deviz.</p></div>
          )}
          <div className="estimate-footer"><p><span>i</span><strong>Verificare administrator</strong> Acțiunile din teren se păstrează. Lucrările incluse în alt tarif sau furnizate de beneficiar se justifică la 0 EUR.</p><div><button className="secondary-button" disabled={!estimateLoaded || savingEstimate} onClick={() => { setSuggestions(current => [...current, catalogSuggestion(`manual-${crypto.randomUUID()}`, undefined, 1, "Poziție adăugată de administrator; descrie lucrarea în observații.")]); setEstimateState("Modificări nesalvate."); }}>Adaugă poziție BoQ</button><button className="secondary-button" disabled={!estimateLoaded || savingEstimate || !budgetReady(suggestions)} onClick={exportEstimate}>Exportă CSV (Excel)</button><button className="primary-button" disabled={!estimateLoaded || savingEstimate || !budgetReady(suggestions)} onClick={saveEstimate}>{savingEstimate ? "Se salvează…" : "Salvează devizul"}</button></div></div>
        </section>
      )}
    </div>
  );
}

