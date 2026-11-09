# Deviz din documentația de teren

Catalog: `BoQ_VBTS FO_PRC.xlsx`, foaia `VBTS Fibre Build`, rândurile 8–208.
Identificatorii afișați sunt numerele rândurilor din fișier, nu coduri contractuale.
Prețurile sunt în EUR fără TVA; unitățile sunt cele din BoQ.

## Reguli automate

Diametrul implicit aprobat pentru cablu este de până la 10 mm. Pentru intervalele
din canalizație se folosește implicit diametrul de 10 mm.

| Operațiune | Rând BoQ | Cantitate |
| --- | --- | --- |
| Cablu pe stâlpi | 91 | metri executați |
| Cablu în canalizație | 83 | metri executați |
| Cablu în pat de cablu existent | 95 | metri executați |
| Cablu pe fațadă | 88 | metri executați |
| Bărcuță / colier inox / cârlig / armorod | 138 / 139 / 140 / 141 | bucăți declarate |
| Instalare joncțiune nouă | 100 | o operațiune pe joncțiune, include maximum 12 suduri |
| Suduri suplimentare | 101 | numai peste pragul inclus în pachet |
| Instalare CPE și acceptanță | 128 | echipamente documentate |
| Instalare SFP / Media Converter | 132 | echipamente documentate |
| Instalare Terminal Box | 110 | module documentate, include maximum 12 suduri/modul |

Se generează și rânduri pentru conectarea ODF/eTN și toate activitățile din
execuția intervențiilor. Acțiunile „Nu s-a intervenit” nu generează rânduri.

## Confirmări necesare

- Accesul la joncțiuni existente folosește implicit 102, fără instalare de cablu nou.
  Rândul 103 se folosește doar la joncțiunea B din care se instalează cablul către
  client, identificată prin capătul traseului și o lungime instalată pozitivă.
  Pachetul include maximum patru suduri. Sudurile peste acest prag apar la 101.
  Rândul 100 rămâne pentru instalarea unei joncțiuni noi.
- Pentru cutii noi, confirmă furnizarea și modelul (142–146). Dacă sunt furnizate
  de beneficiar, alege „Inclus / beneficiar” și introdu o justificare.
- Instalarea patchcordului se facturează la rândul 108, până la 5 metri,
  cu tariful de 3,5823 EUR/patchcord din BoQ. Conectarea ODF/eTN generează această
  poziție automat. Regula corectează și pozițiile de patchcord salvate anterior
  la 0 EUR sau la rândul 109; modificările se persistă prin salvarea devizului.
- Pentru instalările FO din intervenții, confirmă montajul. Lungimea vine din teren.
- Pentru diagnostic OTDR, completează numărul de fibre și distribuie între 111
  (primele patru) și 112 (suplimentare). Fotografiile nu sunt număr de fibre.
- Pentru remedieri și documentația veche cu numai un total de suduri, verifică
  pachetul și distribuția; nu se inventează numărul de suduri sau joncțiuni.
- Când aceeași lucrare este inclusă în alt pachet (de exemplu sudurile unui
  Terminal Box), marcheaz-o „Inclus / beneficiar” și indică poziția care o include.

Toate acțiunile din teren rămân vizibile. Pozițiile fără tarif confirmat sau cu
cantitate zero blochează salvarea și exportul. Se pot adăuga manual și alte poziții
din întregul catalog. Cantitățile și alegerea rândului pot fi corectate de management.
Prețurile și unitățile sunt recalculate pe server din catalog, nu din cererea clientului.

## Salvare și export

`Salvează devizul` persistă devizul separat de raport, în `project_estimates`.
La redeschidere se reconciliază cu acțiunile actuale: acțiuni noi adăugate,
acțiuni eliminate din sursă înlăturate, poziții manuale păstrate. O schimbare a
documentației între deschiderea și salvarea devizului produce răspuns 409.
Devizul se salvează din nou după verificarea actualizărilor.

Butonul `Salvează și descarcă Excel (.xlsx)` salvează întâi devizul pe server,
apoi completează direct modelul original `BoQ_VBTS FO_PRC.xlsx`. Se păstrează
cele două foi, formatarea, dimensiunile, protecția, validările, formulele și
setările de tipărire. Se completează data emiterii, compania Proconect, clientul,
RID-ul și cantitățile în celulele existente. Pozițiile aceleiași linii BoQ sunt
cumulate; lucrările incluse în alte tarife nu produc o facturare separată.

Formulele originale se păstrează, inclusiv `SUBTOTAL(9,H8:H208)`. Totalul din
aplicație și raport însumează valorile nerotunjite pe poziții și rotunjește doar
valoarea finală afișată, în acord cu modelul. Tarifele nu sunt schimbate.
Fișierul nu este sincronizat automat în Drive/OneDrive.

## Realizări per tehnician

În secțiunea **Echipă**, raportul **Realizări per tehnician** permite selectarea
tehnicianului și perioadei, după **data creării proiectului** (`projects.created_at`),
conform alegerii utilizatorului. Sunt incluse numai lucrările cu statusul
`Finalizat`, alocate username-ului selectat. Ambele zile ale perioadei sunt incluse
în fusul `Europe/Bucharest`, inclusiv schimbările de oră. Fotografiile, data
închiderii, editările și data devizului nu schimbă încadrarea proiectului.

Fiecare rând prezintă lucrarea, tipul, clientul, data creării și totalul devizului
salvat, fără TVA. Lucrările fără deviz valid sunt semnalate, cu valoare goală, nu
zero. Raportul se poate descărca în `.xlsx`, cu totalul perioadei. Migrarea
`0009_technician_created_report.sql` adaugă indexul pentru această filtrare.
Coloanele și indexurile istorice sunt păstrate pentru compatibilitate.

Migrarea `0006_project_estimates.sql` trebuie aplicată înaintea publicării, prin
comanda D1 de deploy existentă. Accesul este rezervat rolurilor de management.

Validare: `node --test tests/project-budget.test.mjs tests/excel-reports.test.mjs`, `python3 scripts/test-migrations.py`,
`npx wrangler types && npx tsc --noEmit`, `npm run lint`, `npm run build`.
