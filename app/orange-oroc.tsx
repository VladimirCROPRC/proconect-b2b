"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { orangeServicePackages } from "./orange-services";
import { type OrangeTicket } from "./orange-oroc-data";
import { localDate } from "./technician-report";
import "./orange-oroc.css";

export function OrangeOrocSection({ onNotify, canManage }: { onNotify: (message: string) => void; canManage: boolean }) {
  const [tickets, setTickets] = useState<OrangeTicket[]>([]);
  const [technicians, setTechnicians] = useState<Array<{username: string; name: string}>>([]);
  const [technicianUsername, setTechnicianUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ticketNumber, setTicketNumber] = useState("");
  const [workDate, setWorkDate] = useState(() => localDate(Date.now()));
  const [servicePackageCode, setServicePackageCode] = useState("");
  const [query, setQuery] = useState("");
  const selectedPackage = orangeServicePackages.find(item => item.code === servicePackageCode);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("ro-RO");
    return tickets.filter(ticket => `${ticket.ticketNumber} ${ticket.technicianName} ${ticket.technicianUsername ?? ""} ${ticket.workDate} ${ticket.servicePackageCode} ${orangeServicePackages.find(item => item.code === ticket.servicePackageCode)?.label ?? ""}`.toLocaleLowerCase("ro-RO").includes(search));
  }, [query, tickets]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/orange-oroc", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as { tickets?: OrangeTicket[]; technicians?: Array<{username: string; name: string}>; error?: string };
        if (!response.ok) throw new Error(payload.error || "Tichetele nu pot fi încărcate.");
        setTickets(payload.tickets ?? []); setTechnicians(payload.technicians ?? []); setError("");
      }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Încărcarea a eșuat."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  function reset() {
    setEditingId(null); setTicketNumber(""); setWorkDate(localDate(Date.now())); setServicePackageCode(""); setTechnicianUsername("");
  }
  function edit(ticket: OrangeTicket) {
    setEditingId(ticket.id); setTicketNumber(ticket.ticketNumber); setWorkDate(ticket.workDate); setServicePackageCode(ticket.servicePackageCode); setTechnicianUsername(ticket.technicianUsername ?? "");
    document.getElementById("orange-ticket-number")?.focus();
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!canManage) return; setSaving(true);
    try {
      const response = await fetch("/api/orange-oroc", { method: editingId ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ticketNumber, workDate, servicePackageCode, technicianUsername }) });
      const payload = await response.json() as { ticket?: OrangeTicket; error?: string };
      if (!response.ok || !payload.ticket) throw new Error(payload.error || "Tichetul nu a putut fi salvat.");
      const saved = payload.ticket;
      setTickets(current => [saved, ...current.filter(ticket => ticket.id !== saved.id)].sort((a, b) => b.workDate.localeCompare(a.workDate) || b.createdAt - a.createdAt));
      reset(); onNotify(`Tichetul ${saved.ticketNumber} a fost salvat în Orange/OROC.`);
    } catch (error) { onNotify(error instanceof Error ? error.message : "Tichetul nu a putut fi salvat."); }
    finally { setSaving(false); }
  }

  return <div className="page-wrap inner-page orange-oroc-page">
    <section className="page-heading compact"><div><p className="eyebrow">ACTIVITĂȚI</p><h1>Orange/OROC</h1><p>{canManage ? "Înregistrează tichete și alocă-le tehnicienilor." : "Tichetele Orange/OROC alocate ție."}</p></div></section>
    {canManage && <section className="project-card orange-ticket-form">
      <div className="card-heading"><div><h2>{editingId ? "Editează tichetul" : "Tichet nou"}</h2><p>Completează numărul, data, pachetul de servicii și tehnicianul.</p></div></div>
      <form onSubmit={save}>
        <label>Număr tichet *<input id="orange-ticket-number" value={ticketNumber} onChange={event => setTicketNumber(event.target.value)} required maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}" autoComplete="off" disabled={saving || loading || Boolean(error)} /></label>
        <label>Data *<input type="date" value={workDate} onChange={event => setWorkDate(event.target.value)} required disabled={saving || loading || Boolean(error)} /></label>
        <label className="orange-package-select">Pachet de servicii *<select value={servicePackageCode} onChange={event => setServicePackageCode(event.target.value)} required disabled={saving || loading || Boolean(error)}><option value="">Selectează pachetul</option>{orangeServicePackages.map(item => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></label>
        <label className="orange-tech-select">Tehnician alocat *<select required value={technicianUsername} onChange={event => setTechnicianUsername(event.target.value)} disabled={saving || loading || Boolean(error)}><option value="">Selectează tehnicianul</option>{technicianUsername && !technicians.some(tech => tech.username === technicianUsername) && <option value={technicianUsername}>{tickets.find(ticket => ticket.id === editingId)?.technicianName || technicianUsername} (istoric / inactiv)</option>}{technicians.map(tech => <option key={tech.username} value={tech.username}>{tech.name} (@{tech.username})</option>)}</select></label>
        <div className="orange-form-actions"><button className="primary-button" disabled={saving || loading || Boolean(error)}>{saving ? "Se salvează…" : editingId ? "Salvează modificările" : "Salvează tichetul"}</button>{editingId && <button type="button" className="secondary-button" onClick={reset} disabled={saving}>Anulează editarea</button>}</div>
      </form>
      {selectedPackage && <details className="orange-package-details"><summary>{selectedPackage.code} · {selectedPackage.label}</summary><p>{selectedPackage.description}</p><small>QAF · Services · rândul {selectedPackage.sourceRow} · UM: {selectedPackage.unit}</small></details>}
    </section>}
    <section className="project-card orange-ticket-list">
      <div className="card-heading"><div><h2>Tichete Orange/OROC</h2><p>{tickets.length} tichete înregistrate</p></div><input className="orange-search" type="search" aria-label="Caută tichete Orange/OROC" placeholder="Caută tichet, dată sau pachet…" value={query} onChange={event => setQuery(event.target.value)} /></div>
      {error && <div className="orange-load-error" role="alert">{error} <button className="secondary-button" onClick={() => { setLoading(true); setError(""); setReload(current => current + 1); }}>Reîncearcă</button></div>}
      {canManage && tickets.some(ticket => !ticket.technicianUsername) && <p className="orange-load-error">{tickets.filter(ticket => !ticket.technicianUsername).length} tichete nealocate. Folosește «Editează» pentru a selecta tehnicianul.</p>}
      <div className="estimate-table-wrap"><table className="estimate-table"><thead><tr><th>Număr tichet</th><th>Data</th><th>Pachet de servicii</th><th>Tehnician</th>{canManage && <th>Acțiuni</th>}</tr></thead><tbody>
        {filtered.map(ticket => { const item = orangeServicePackages.find(item => item.code === ticket.servicePackageCode); return <tr key={ticket.id}><td><strong>{ticket.ticketNumber}</strong></td><td>{ticket.workDate}</td><td><strong>{ticket.servicePackageCode}</strong><small>{item?.label ?? "Pachet salvat"}</small></td><td><strong>{ticket.technicianName || ticket.technicianUsername || "Nealocat"}</strong>{ticket.technicianUsername && <small>@{ticket.technicianUsername}</small>}</td>{canManage && <td><button className="secondary-button" onClick={() => edit(ticket)} disabled={saving || loading}>Editează</button></td>}</tr>; })}
        {!filtered.length && <tr><td colSpan={canManage ? 5 : 4}>{loading ? "Se încarcă tichetele…" : error ? "Lista nu este disponibilă." : query.trim() ? "Niciun tichet nu corespunde căutării." : canManage ? "Nu există încă tichete Orange/OROC." : "Nu ai tichete Orange/OROC alocate."}</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
