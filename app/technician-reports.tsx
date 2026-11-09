"use client";

import { type FormEvent, useEffect, useState } from "react";
import { downloadExcel } from "./excel-export";
import { technicianReportSheet } from "./workbook-models";
import { localDate, type TechnicianReport } from "./technician-report";
import "./technician-reports.css";

const money = (value: number) => value.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " EUR";

export function TechnicianReports({ onEditWork }: { onEditWork: (id: string) => void }) {
  const [technicians, setTechnicians] = useState<Array<{ username: string; name: string }>>([]);
  const [technician, setTechnician] = useState("");
  const [from, setFrom] = useState(() => localDate(Date.now()).slice(0, 7) + "-01");
  const [to, setTo] = useState(() => localDate(Date.now()));
  const [report, setReport] = useState<TechnicianReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/technician-reports", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as { technicians?: Array<{ username: string; name: string }>; error?: string };
        if (!response.ok) throw new Error(payload.error || "Lista tehnicienilor nu este disponibilă.");
        setTechnicians(payload.technicians ?? []);
      }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Lista tehnicienilor nu este disponibilă."); });
    return () => controller.abort();
  }, []);

  async function generate(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setReport(null);
    try {
      const response = await fetch(`/api/technician-reports?${new URLSearchParams({ technician, from, to })}`, { credentials: "same-origin", cache: "no-store" });
      const payload = await response.json() as { report?: TechnicianReport; error?: string };
      if (!response.ok || !payload.report) throw new Error(payload.error || "Raportul nu a putut fi generat.");
      setReport(payload.report);
    } catch (error) { setError(error instanceof Error ? error.message : "Raport indisponibil."); }
    finally { setLoading(false); }
  }

  function exportReport() {
    if (!report) return;
    downloadExcel(technicianReportSheet(report), `Realizari-${report.technician.username}-${report.from}-${report.to}.xlsx`);
  }

  return <section className="technician-reports project-card">
    <div className="card-heading"><div><h2>Realizări per tehnician</h2><p>Toate statusurile. Perioada este filtrată după data creării lucrării/tichetului. Valori fără TVA; Orange/OROC fără valori.</p></div></div>
    <form className="technician-report-filters" onSubmit={generate}>
      <label>Tehnician<select aria-label="Tehnician pentru raport" required value={technician} disabled={loading} onChange={event => { setTechnician(event.target.value); setReport(null); }}><option value="">Selectează tehnicianul</option>{technicians.map(tech => <option key={tech.username} value={tech.username}>{tech.name} (@{tech.username})</option>)}</select></label>
      <label>De la<input aria-label="Început perioadă" type="date" required value={from} max={to} disabled={loading} onChange={event => { setFrom(event.target.value); setReport(null); }} /></label>
      <label>Până la<input aria-label="Sfârșit perioadă" type="date" required value={to} min={from} disabled={loading} onChange={event => { setTo(event.target.value); setReport(null); }} /></label>
      <button className="primary-button" disabled={loading || !technician}>{loading ? "Se generează…" : "Generează raport"}</button>
    </form>
    {error && <p className="technician-report-error" role="alert">{error}</p>}
    {report && <div className="technician-report-result">
      <div className="technician-report-summary"><div><strong>{report.technician.name} · {report.works.length} lucrări</strong><p>{report.from} – {report.to} · Date în fusul Europe/Bucharest</p></div><strong>{money(report.total)}</strong><button className="secondary-button" onClick={exportReport}>Descarcă raport Excel</button></div>
      {report.missingEstimates > 0 && <p role="status">{report.missingEstimates} lucrări nu au un deviz valid salvat. Totalul include doar devizele disponibile.</p>}
      <div className="estimate-table-wrap"><table className="estimate-table"><thead><tr><th>Lucrare</th><th>Tip</th><th>Status</th><th>Client / Pachet</th><th>Data creării</th><th>Valoare deviz fără TVA</th></tr></thead><tbody>
        {report.works.map(work => <tr key={`${work.source ?? "project"}:${work.id}`}><td>{work.source === "orange-oroc" ? <strong>{work.id}</strong> : <button className="secondary-button" onClick={() => onEditWork(work.id)}>{work.id}</button>}</td><td>{work.activityType}</td><td>{work.status}</td><td><strong>{work.client}</strong><small>{work.servicePackage || work.address}</small></td><td>{localDate(work.createdAt)}</td><td>{work.source === "orange-oroc" ? "Fără valori" : work.total === null ? `Deviz ${work.estimateStatus}` : money(work.total)}</td></tr>)}
        {!report.works.length && <tr><td colSpan={6}>Nicio lucrare creată în această perioadă.</td></tr>}
      </tbody></table></div>
      {report.undated.length > 0 && <details><summary>{report.undated.length} lucrări fără dată de creare — neincluse</summary><p>Verifică datele lucrării, apoi generează din nou raportul.</p>{report.undated.map(work => <button key={work.id} className="secondary-button" onClick={() => onEditWork(work.id)}>{work.id} · {work.client}</button>)}</details>}
    </div>}
  </section>;
}
