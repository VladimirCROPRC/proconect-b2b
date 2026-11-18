"use client";
import { accountRoles, type AppRole } from "./account-roles";

export function AccountRoleFields({ selected = ["Tehnician"] }: { selected?: readonly string[] }) {
  return <fieldset style={{ border: "1px solid #dce4ed", borderRadius: 8, padding: 16 }}>
    <legend>Roluri</legend>
    <div style={{ display: "grid", gap: 12 }}>
      {accountRoles.map(role => <label key={role} style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input type="checkbox" name="roles" value={role} defaultChecked={selected.includes(role)} style={{ width: 18, height: 18 }} />
        <span>{role}</span>
      </label>)}
    </div>
  </fieldset>;
}

const descriptions: Record<AppRole, string> = {
  Admin: "Administrare conturi, configurare și lucrări",
  Manager: "Rapoarte și gestionarea lucrărilor",
  Coordonator: "Alocare lucrări și coordonare",
  Tehnician: "Lucrările alocate și documentarea din teren",
};

export function ActiveRolePicker({ name, roles, busy, error, onSelect, onSignOut }: {
  name: string; roles: readonly AppRole[]; busy: boolean; error: string;
  onSelect: (role: AppRole) => void; onSignOut: () => void;
}) {
  return <main className="auth-shell"><section className="auth-card">
    <h1>Alege rolul activ</h1>
    <p>{name}, selectează rolul cu care dorești să lucrezi.</p>
    <div style={{ display: "grid", gap: 12, margin: "24px 0" }}>
      {roles.map(role => <button type="button" className="secondary-button" key={role} disabled={busy}
        style={{ display: "grid", gap: 6, textAlign: "left", padding: 16, whiteSpace: "normal" }} onClick={() => onSelect(role)}>
        <strong>{role}</strong><span>{descriptions[role]}</span>
      </button>)}
    </div>
    {busy && <p role="status">Se activează rolul…</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button type="button" className="secondary-button" disabled={busy} onClick={onSignOut}>Deconectare</button>
  </section></main>;
}
