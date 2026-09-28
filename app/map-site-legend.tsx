export function mapSiteMarkerClass(code: string) {
  const normalized = code.trim().toUpperCase();
  if ((normalized.startsWith("L") && normalized.includes("-")) || /^(?=.*-)[0-9-]+$/.test(normalized)) {
    return "site-code-numeric-hyphen";
  }
  if (normalized.startsWith("JU")) return "site-code-ju";
  if (normalized.startsWith("J")) return "site-code-j";
  return "";
}

export function MapSiteLegend() {
  return (
    <div className="map-site-legend" aria-label="Legenda punctelor de pe hartă">
      <span><i className="mobile" />Roșu — Joncțiuni Vodafone Mobil</span>
      <span><i className="fixed" />Albastru — Joncțiuni Vodafone Fixed</span>
      <span><i className="clients" />Negru — Clienți</span>
      <span><i className="sites" />Verde — Site-uri</span>
    </div>
  );
}
