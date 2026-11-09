# Copie Ubuntu: b2b.proconect.online

Aplicația actuală `proconect.online` rămâne pe Cloudflare. Acest pachet pornește
o copie independentă pe Ubuntu: Next.js/Node 24, SQLite și fișiere locale.
Cloudflare Access autentifică utilizatorii prin One-time PIN pe email;
Cloudflare Tunnel publică noul hostname fără porturi publice către aplicație.
Traficul trece prin Cloudflare, dar aplicația și datele sunt pe Ubuntu.

Nu s-a executat încă importul datelor reale sau configurarea DNS/Access.
Instrucțiunile de mai jos se rulează pe infrastructura ta. Nu trimite parole,
chei R2 sau tokenuri de tunel în conversație ori în GitHub.

## 1. Pregătirea serverului

Este necesar Ubuntu cu Docker Engine și Docker Compose v2. Verifică:

```bash
docker --version
docker compose version
```

Dacă lipsesc, instalează din [documentația Docker pentru Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
Asigură spațiu pentru baza și fișierele copiate, plus exportul intermediar.

```bash
git clone --branch selfhost/ubuntu-b2b-access https://github.com/VladimirCROPRC/proconect-b2b.git proconect-b2b-copy
cd proconect-b2b-copy
mkdir -p imports .secrets
sudo install -d -m 700 -o 1000 -g 1000 data
cp deploy/selfhost/env.example .env.selfhost
chmod 600 .env.selfhost
```

Nu porni încă `app`: mai întâi se importă datele, ca să nu se inițializeze
din greșeală o bază goală. Comanda de build generează automat tipurile de bază de date cu Wrangler, apoi
compilează serverul Node. Nu depinde de fișiere generate pe calculatorul
dezvoltatorului. Buildul poate fi făcut acum:

```bash
docker compose -f compose.selfhost.yml build app
```

## 2. Access și Tunnel pentru hostname-ul NOU

În Cloudflare Zero Trust:

1. Activează furnizorul **One-time PIN**.
2. Creează o aplicație **Access → Self-hosted** pentru **b2b.proconect.online**,
   inclusiv toate căile și API-urile. Nu modifica aplicația/domeniul original.
3. Politica Allow: **Include → Emails**, cu adresele aprobate; **Require →
   Login methods → One-time PIN**. Nu folosi Everyone sau doar metoda PIN
   drept criteriu Include.
4. Copiază domeniul echipei (`https://ECHIPA.cloudflareaccess.com`) și
   **Application Audience (AUD)** din această aplicație în `.env.selfhost`.
5. Creează un tunel separat. Public hostname: `b2b.proconect.online`, service
   **HTTP → app:3000** pentru conectorul Docker din acest compose. Configurează
   validarea Access la nivelul tunelului pentru aceeași aplicație. Aplicația
   verifică separat semnătura, issuer-ul, AUD-ul și expirarea tokenului.
6. Salvează tokenul tunelului în `.secrets/cloudflared-token`, pe o singură
   linie. Nu îl pune în comenzi partajate sau în fișiere urmărite de Git.

```bash
sudo chown 1000:1000 .secrets/cloudflared-token
sudo chmod 400 .secrets/cloudflared-token
```

Pornește tunelul abia după verificarea aplicației și asocierea emailului de
administrator. Adaugă numai înregistrarea DNS pentru noul subdomeniu; nu
schimba ruta Worker sau DNS-ul pentru `proconect.online`.

## 3. Exportul sursei

Exportul păstrează înregistrările sursă, dar D1 poate bloca temporar cererile
pe durata lui. Planifică-l într-un interval fără lucru în aplicație.
Cloudflare cere permisiunea D1 Write / Account → D1 → Edit chiar pentru
export; un token D1 Read nu este suficient. Folosește un token temporar
limitat la contul sursă, păstrat numai pe calculatorul tău.

Rulează exportul pe un calculator autentificat în contul Cloudflare corect,
în checkout-ul proiectului care conține configurația Wrangler:

```bash
mkdir -p imports/r2
npx wrangler d1 export proconect-b2b-db --remote --output ./imports/proconect.sql
```

Pentru fișiere, configurează un remote rclone numit `r2`, de tip S3/Cloudflare,
cu endpoint `https://ACCOUNT_ID.r2.cloudflarestorage.com` și o cheie cu acces
de citire la bucketul `proconect-b2b-files`. Cheia rămâne numai în configurația
locală a rclone. Copierea de mai jos nu modifică bucketul:

```bash
rclone copy r2:proconect-b2b-files ./imports/r2 --progress
```

Alege o fereastră în care tehnicienii nu modifică lucrările/fișierele pe
durata exportului. Baza și R2 nu formează împreună o tranzacție: dacă un fișier
este modificat sau șters între cele două copii, importul se oprește și trebuie
refăcut un export coerent. Nu folosi `rclone sync` către bucketul sursă.

Transferă `imports/` pe Ubuntu, în checkout-ul copiei, păstrând căile R2:

```bash
rsync -av ./imports/ UTILIZATOR@SERVER:~/proconect-b2b-copy/imports/
```

Pe Ubuntu:

```bash
sudo chown -R 1000:1000 imports
sudo chmod -R go-rwx imports
docker compose -f compose.selfhost.yml run --rm --no-deps --volume "$PWD/server/selfhost:/app/server/selfhost:ro" --entrypoint node app server/selfhost/import-copy.mjs /imports/proconect.sql /imports/r2
```

Importul folosește scriptul din checkout-ul curent și acceptă ordinea tabelelor
din exportul D1. Relațiile sunt verificate după încărcarea completă a SQL-ului.

Importul:

- refuză suprascrierea unei copii existente;
- verifică schema, integritatea SQL și referințele dintre tabele;
- păstrează ID-urile, username-urile, rolurile, alocările, lucrările, devizele,
  documentația și tichetele Orange/OROC;
- verifică dimensiunea și SHA-256 pentru fiecare fișier referit de bază;
- elimină **numai din copia locală** sesiunile vechi, autorizările OAuth,
  conexiunile/folderele de sincronizare Google Drive și OneDrive;
- scrie numerele de înregistrări și hash-urile în `data/copy-manifest.json`.

Parolele hash-uite din baza veche sunt păstrate ca date copiate, dar nu sunt
acceptate pentru autentificare în această copie. Nu există revenire la login
cu parolă dacă Access este indisponibil. Nu sunt create conturi demo.

## 4. Asocierea emailurilor fără pierderea alocărilor

Listează conturile importate:

```bash
docker compose -f compose.selfhost.yml run --rm --no-deps --entrypoint node app server/selfhost/users.mjs list
```

Asociază emailul administratorului unui **username existent cu rol Admin**:

```bash
docker compose -f compose.selfhost.yml run --rm --no-deps --entrypoint node app server/selfhost/users.mjs email USERNAME_ADMIN ADMIN@EXEMPLU.RO
```

Repetă pentru tehnicieni sau completează ulterior din **Echipă → Email acces**.
Un email poate corespunde unui singur cont. Conturile inactive nu primesc
acces. Emailul trebuie aprobat atât în politica Access, cât și asociat unui
cont local. În aplicație rămân aceleași username-uri, roluri și alocări.

Nu transforma fiecare utilizator autentificat de Cloudflare în administrator.
Rolurile sunt citite exclusiv din baza locală, nu din headerele browserului.

## 5. Verificare și pornire

```bash
docker compose -f compose.selfhost.yml run --rm --no-deps --entrypoint node app server/selfhost/verify-files.mjs
docker compose -f compose.selfhost.yml up -d app
curl --fail http://127.0.0.1:3001/api/selfhost/health
docker compose -f compose.selfhost.yml --profile tunnel up -d
docker compose -f compose.selfhost.yml ps
```

Deschide `https://b2b.proconect.online`, introdu emailul aprobat, apoi codul.
Verifică un cont administrator și un tehnician: alocări, fotografii, documente,
devize, fișe și cele două foi din raportul zilnic. Un utilizator fără email
asociat nu trebuie să intre; endpointurile cu date cer JWT valid și rol local.

Portul aplicației este expus doar pe `127.0.0.1:3001`, nu pe interfața publică.
Nu activa cache Cloudflare pentru `/api/*` sau răspunsurile autentificate.
Pentru PIN, păstrează durata de sesiune Access la valoarea aleasă explicit
pentru echipa ta; nu presupune că logout-ul altui dispozitiv revocă instant
toate tokenurile deja emise. Dezactivarea contului local blochează cererile noi.

## 6. Operare și revenire

- Datele persistă în `data/` la restart/rebuild. Nu șterge acest director.
- Pentru backup consistent, oprește temporar serviciul app, salvează directorul
  `data/`, apoi repornește-l. Păstrează backupul într-o destinație separată.
- Nu reconecta copiile la aceleași foldere Drive/OneDrive fără o decizie
  explicită. Conectează destinații separate pentru noua instanță. Retry-ul
  OneDrive rulează și în fundal în varianta Node.
- Pentru a retrage copia, oprește acest compose și elimină hostname-ul nou din
  Tunnel/Access. Aplicația și datele sursă rămân în producție.
- Dockerfile-ul folosește Node 24 și Compose folosește imaginea oficială
  cloudflared. În exploatare poți fixa digesturile imaginilor aprobate.

## Surse oficiale

- [Next.js self-hosting / standalone](https://nextjs.org/docs/app/getting-started/deploying)
- [Cloudflare One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Validarea JWT Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Export D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Rclone pentru R2](https://developers.cloudflare.com/r2/examples/rclone/)
- [Token-file pentru Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
