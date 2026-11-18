export async function readOneDriveResponse<T extends { error?: string }>(response: Response): Promise<T> {
  const loginUrl = response.url && new URL(response.url);
  if (loginUrl && (loginUrl.hostname.endsWith(".cloudflareaccess.com") || loginUrl.pathname.startsWith("/cdn-cgi/access/"))) {
    throw new Error("Sesiunea Cloudflare Access necesită autentificare. Reîncarcă pagina și autentifică-te din nou.");
  }
  const type = response.headers.get("Content-Type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Accesul la aplicație trebuie verificat (HTTP ${response.status}). Reîncarcă pagina și autentifică-te din nou.`);
    }
    if (response.status >= 500) {
      throw new Error(`Serverul sau conexiunea Cloudflare a returnat o pagină de eroare (HTTP ${response.status}). Reîncearcă după verificarea serverului.`);
    }
    throw new Error(`Aplicația a primit o pagină HTML în locul răspunsului așteptat (HTTP ${response.status}). Reîncarcă pagina și verifică autentificarea.`);
  }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error(`Răspunsul serverului este incomplet sau invalid (HTTP ${response.status}). Reîncearcă operațiunea.`); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Serverul a returnat un răspuns cu format invalid.");
  }
  const result = payload as T;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `Operațiunea a eșuat (HTTP ${response.status}).`);
  return result;
}
