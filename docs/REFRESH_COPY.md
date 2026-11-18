# Actualizarea lucrărilor din copia Ubuntu

Se exportă din nou baza D1 și se completează copia locală R2 folosind `rclone copy`.
Exportul SQL nou se salvează separat în `imports/proconect-refresh.sql`.
Comenzile de export și copiere citesc din proconect.online.

Pentru lucrările prezente în sursă se preia întregul set actual de date din
proconect.online, inclusiv devizul, documentația, raportul și fotografiile.
Fotografiile și liniile șterse din sursă dispar din varianta locală a aceleiași
lucrări. Lucrările care există numai în b2b sunt păstrate. Tichetele Orange/OROC
sunt actualizate după numărul de tichet. Un tichet care există numai local rămâne
în copie.

Conturile existente, emailurile Cloudflare Access, echipele și conexiunile
OneDrive/Google Drive sunt păstrate. Utilizatorii noi ai sursei sunt adăugați
fără asociere automată de email în Cloudflare Access.

După ce exportul și copierea R2 s-au încheiat:

```bash
cd ~/proconect-b2b-copy
git pull --ff-only
sudo chown -R 1000:1000 imports
sudo chmod -R go-rwx imports
docker compose -f compose.selfhost.yml stop app
docker compose -f compose.selfhost.yml run --rm --no-deps \
  --volume "$PWD/server/selfhost:/app/server/selfhost:ro" \
  --entrypoint node app \
  server/selfhost/refresh-copy.mjs /imports/proconect-refresh.sql /imports/r2
```

Scriptul verifică separat exportul și fiecare fișier sursă înainte de modificare.
Salvează baza locală și manifestul în `data/backups/before-refresh-*`. La succes,
același director conține și vechiul director `files`. Modificările bazei se aplică
într-o tranzacție, iar o eroare înainte de finalizare declanșează restaurarea
fișierelor și a manifestului dacă acestea au fost deja mutate. Păstrează backupul
indicat în rezultatul comenzii. Copierea poate necesita spațiu suplimentar pentru
staging și backup.

Verifică rezultatul JSON și apoi rulează:

```bash
docker compose -f compose.selfhost.yml run --rm --no-deps \
  --volume "$PWD/server/selfhost:/app/server/selfhost:ro" \
  --entrypoint node app server/selfhost/verify-files.mjs
docker compose -f compose.selfhost.yml up -d app
curl --fail --retry 5 --retry-connrefused --retry-delay 3 \
  http://127.0.0.1:3001/api/selfhost/health
```

Actualizarea poate fi repetată fără dublarea lucrărilor. Conexiunea OneDrive
existentă este păstrată, iar copiile lucrărilor sunt reintroduse în coadă dacă
OneDrive este activ. Centralizatorul automat este invalidat pentru a se reface
din datele actualizate, dacă funcția a fost activată pe server.

Exportul D1 și copierea R2 nu sunt o singură tranzacție. Dacă un obiect lipsește
sau dimensiunea lui diferă de baza exportată, scriptul se oprește înainte de
actualizare. În acest caz se reia copierea sau se obține un export nou.
