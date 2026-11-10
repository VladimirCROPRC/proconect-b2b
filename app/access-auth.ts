import { createRemoteJWKSet, jwtVerify } from "jose";

export function normalizedAccessEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function accessConfiguration(teamDomain: string | undefined, audience: string | undefined) {
  if (!teamDomain || !audience) throw new Error("Configurează CF_ACCESS_TEAM_DOMAIN și CF_ACCESS_AUD pentru copia B2B.");
  const issuer = new URL(teamDomain);
  if (issuer.protocol !== "https:" || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer.hostname) || issuer.port || issuer.username || issuer.password || issuer.pathname !== "/" || issuer.search || issuer.hash || !/^[a-f0-9]{64}$/i.test(audience)) throw new Error("Configurare Cloudflare Access invalidă.");
  return { issuer: issuer.origin, audience };
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function accessIdentity(request: Request, configuration: ReturnType<typeof accessConfiguration>, resolver?: ReturnType<typeof createRemoteJWKSet>) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16384) return null;
  let keys = resolver ?? keySets.get(configuration.issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${configuration.issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 300000 });
    keySets.set(configuration.issuer, keys);
  }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: configuration.issuer, audience: configuration.audience, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "email"], clockTolerance: 5 });
    const email = normalizedAccessEmail(payload.email);
    if (!email || typeof payload.sub !== "string" || !payload.sub || payload.type !== "app") return null;
    return { email, subject: payload.sub };
  } catch { return null; }
}
