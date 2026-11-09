"use client";

import { downloadExcel } from "./excel-export";
import { fieldSheetExcel, fieldSheetPrintHtml, type FieldSheet } from "./project-field-sheets";
import "./project-field-sheets.css";

export function ProjectFieldSheetPreview({ sheet, onNotify }: { sheet: FieldSheet; onNotify: (message: string) => void }) {
  function print() {
    const frame = document.createElement("iframe");
    frame.title = sheet.title;
    frame.style.cssText = "position:fixed;left:-10000px;width:1120px;height:800px;border:0";
    frame.onload = () => {
      const target = frame.contentWindow;
      if (!target) { frame.remove(); onNotify("Fișa nu a putut fi pregătită pentru tipărire."); return; }
      target.onafterprint = () => frame.remove();
      try { target.focus(); target.print(); } catch { frame.remove(); onNotify("Tipărirea nu a putut fi deschisă."); }
      setTimeout(() => frame.remove(), 300_000);
    };
    frame.srcdoc = fieldSheetPrintHtml(sheet);
    document.body.appendChild(frame);
  }
  return <section className="field-sheet-card">
    <div className="document-toolbar"><div><span>{sheet.title === "Fișă de materiale" ? "MAT" : "FO"}</span><p><strong>{sheet.title} · {sheet.project.id}</strong><small>Generată din datele salvate în teren</small></p></div><div><button onClick={print}>Tipărește / Salvează PDF</button><button className="primary-button" onClick={() => downloadExcel(fieldSheetExcel(sheet), sheet.filename)}>Descarcă Excel</button></div></div>
    <article className="field-sheet-paper"><h2>{sheet.title}</h2><p><strong>{sheet.project.id} · {sheet.project.client}</strong><br />{sheet.project.address}</p>
      <div className="field-sheet-table-wrap"><table><thead><tr>{sheet.headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{sheet.rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{typeof value === "number" ? value.toLocaleString("ro-RO") : value}</td>)}</tr>)}</tbody></table></div>
      {sheet.notes.map(note => <p className="field-sheet-note" key={note}>{note}</p>)}
    </article>
  </section>;
}
