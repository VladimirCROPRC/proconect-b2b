"use client";

import { useState, type FormEvent } from "react";
import { localDate } from "./technician-report";
import type { DailyReport } from "./daily-technician-report";
import { dailyReportSheets } from "./daily-report-workbook";
import { downloadExcel } from "./excel-export";

const money = (value: number) => value.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " EUR";
const quantity = (value: number) => value.toLocaleString("ro-RO", { maximumFractionDigits: 4 });

export function DailyTechnicianReports({ technicians, onEditWork }: { technicians: Array<{ username: string; name: string }>; onEditWork: (id: string) => void }) {
  const [technician, setTechnician] = useState("");
  const [from, setFrom] = useState(() => localDate(Date.now()));
  const [to, setTo] = useState(() => localDate(Date.now()));
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function generate(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setReport(null);
    try {
      const response = await fetch(`/api/daily-technician-reports?${new URLSearchParams({ technician, from, to })}`, { credentials: "same-origin", cache: "no-store" });
      const result = await response.json() as { report?: DailyReport; error?: string };
      if (!response.ok || !result.report) throw new Error(result.error || "Raport indisponibil.");
      setReport(result.report);
    } catch (error) { setError(error instanceof Error ? error.message : "Raport indisponibil."); }
    finally { setLoading(false); }
  }
  return <section className="technician-reports project-card">
    <div className="card-heading"><div><h2>Raport zilnic per tehnician</h2><p>Manopere din teren: data ultimei fotografii a fiecărei manopere încărcate de tehnician. Orange/OROC: data execuției din tichet. Date Europe/Bucharest.</p><p>Traseul FO, clientul și site-ul au fotografii comune pe secțiune. Exportul Excel are două foi (teren și Orange/OROC), cu o linie per lucrare și total general în foaia principală. Materialele nu sunt incluse. Valorile sunt fără TVA, din devizul salvat sau tariful Orange/OROC (SP2 FOA: 300 EUR).</p></div></div>
    <form className="technician-report-filters" onSubmit={generate}>
      <label>Tehnician<select aria-label="Tehnician raport zilnic" required value={technician} disabled={loading} onChange={event => { setTechnician(event.target.value); setReport(null); }}><option value="">Selectează tehnicianul</option>{technicians.map(tech => <option key={tech.username} value={tech.username}>{tech.name} (@{tech.username})</option>)}</select></label>
      <label>De la<input aria-label="Început raport zilnic" type="date" required value={from} max={to} disabled={loading} onChange={event => { setFrom(event.target.value); setReport(null); }} /></label>
      <label>Până la<input aria-label="Sfârșit raport zilnic" type="date" required value={to} min={from} disabled={loading} onChange={event => { setTo(event.target.value); setReport(null); }} /></label>
      <button className="primary-button" disabled={loading || !technician}>{loading ? "Se generează…" : "Generează raport zilnic"}</button>
    </form>
    {error && <p role="alert" className="technician-report-error">{error}</p>}
    {report && <div className="technician-report-result">
      <div className="technician-report-summary"><div><strong>{report.technician.name} · {report.days.length} zile cu activitate</strong><p>{report.from} – {report.to}</p></div><strong>{money(report.total)}</strong><button className="secondary-button" onClick={() => downloadExcel(dailyReportSheets(report), `Raport-zilnic-${report.technician.username}-${report.from}-${report.to}.xlsx`)}>Descarcă raport zilnic Excel</button></div>
      {!report.days.length && <p>Nicio manoperă sau pachet de servicii datat în această perioadă.</p>}
      {report.days.map(day => <section className="daily-report-day" key={day.date}>
        <div className="technician-report-summary"><h3>{day.date}</h3><strong>{money(day.total)}</strong></div>
        {day.unpriced > 0 && <p>{day.unpriced} poziții fără valoare confirmată. Totalul include doar valorile disponibile.</p>}
        <div className="estimate-table-wrap"><table className="estimate-table"><thead><tr><th>BoQ / Pachet</th><th>Manoperă / Serviciu</th><th>Cantitate</th><th>UM</th></tr></thead><tbody>{day.summary.map((item, index) => <tr key={index}><td>{item.code || "De completat"}</td><td>{item.name}</td><td>{quantity(item.quantity)}{item.incomplete > 0 && <small>{item.incomplete} cantități de completat</small>}</td><td>{item.unit}</td></tr>)}</tbody></table></div>
        <details><summary>Detalii pe lucrări și tichete ({day.lines.length} poziții)</summary><div className="estimate-table-wrap"><table className="estimate-table"><thead><tr><th>Lucrare / Tichet</th><th>Manoperă / Pachet</th><th>Cantitate</th><th>Valoare fără TVA</th><th>Observații</th></tr></thead><tbody>{day.lines.map(line => <tr key={line.key}><td>{line.source === "Teren" ? <button className="secondary-button" onClick={() => onEditWork(line.workId)}>{line.workId}</button> : <strong>{line.workId}</strong>}<small>{line.client}</small></td><td>{line.code} · {line.name}</td><td>{line.quantity === null ? "De completat" : quantity(line.quantity)} {line.unit}</td><td>{line.total === null ? "Fără valori" : money(line.total)}</td><td>{line.note}</td></tr>)}</tbody></table></div></details>
      </section>)}
      {report.undated.length > 0 && <details><summary>{report.undated.length} manopere fără fotografie asociată — neincluse în zile și total</summary><p>Lista include toate manoperele fără dată ale tehnicianului; ele nu pot fi filtrate după perioadă.</p><ul>{report.undated.map(line => <li key={line.key}><button className="secondary-button" onClick={() => onEditWork(line.workId)}>{line.workId}</button> · {line.name} · {line.quantity === null ? "Cantitate de completat" : `${quantity(line.quantity)} ${line.unit}`}</li>)}</ul></details>}
      {report.warnings.length > 0 && <div role="status">{report.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
    </div>}
  </section>;
}
