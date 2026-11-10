import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const domain = new URL(process.env.CF_ACCESS_TEAM_DOMAIN || 'https://invalid.local');
if (domain.protocol !== 'https:' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain.hostname) || domain.pathname !== '/' || domain.port || domain.username || domain.password || domain.search || domain.hash || !/^[a-f0-9]{64}$/i.test(process.env.CF_ACCESS_AUD || '')) throw new Error('Completează domeniul echipei și AUD-ul aplicației Cloudflare Access.');
if (process.env.PROCONECT_APP_URL !== 'https://b2b.proconect.online') throw new Error('Originea acestei copii trebuie să fie https://b2b.proconect.online.');
if (!existsSync(resolve(process.env.PROCONECT_DATA_DIR || '/data', 'app.sqlite'))) throw new Error('Importă mai întâi copia bazei de date și fișierelor. Aplicația nu pornește cu o bază goală creată accidental.');
console.log('Configurația copiei B2B este validă.');
