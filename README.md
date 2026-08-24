# Proconect B2B

Aplicație internă pentru documentarea lucrărilor de fibră optică.

## Funcționalități

- Management proiecte și conturi cu autentificare username/parolă.
- Documentație client, trasee FO, suduri FO și operațiuni site.
- Hărți OpenStreetMap cu registrul Optix.
- Fotografii, rapoarte și sincronizare Google Drive.
- Acces separat pentru administratori, coordonatori și tehnicieni.

## Publicare în Cloudflare

1. Creează baza D1 `proconect-b2b-db`.
2. Creează bucket-ul R2 `proconect-b2b-files`.
3. Înlocuiește `YOUR_D1_DATABASE_ID` din `wrangler.jsonc` cu identificatorul bazei.
4. Configurează secretele `PROCONECT_ADMIN_PASSWORD`, `PROCONECT_TECHNICIAN_PASSWORD` și `PROCONECT_DRIVE_ENCRYPTION_KEY` exclusiv în Cloudflare.
5. Conectează repository-ul prin Cloudflare Workers & Pages → Create application → Import a repository.
6. Comanda de build: `npm run build`.
7. Comanda de deploy: `npx wrangler d1 migrations apply proconect-b2b-db --remote && npx wrangler deploy --config wrangler.jsonc`.
8. Adaugă noul URL în Google Cloud OAuth și reconectează Google Drive.

Nu adăuga parole, tokenuri, fotografii ale clienților sau exporturi ale bazei de date în repository.
