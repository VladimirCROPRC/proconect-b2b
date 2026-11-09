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
apoi descarcă un fișier Excel OOXML real cu rândul BoQ, cantitatea, tariful,
valoarea, documentarea și observațiile. Nu completează fișierul XLSX original.
Cantitățile și tarifele sunt numerice; valorile și totalul au formule Excel și
rezultate memorate. Valorile pe rând se rotunjesc la două
zecimale, iar totalul însumează aceste valori. Devizul nu este sincronizat automat
cu fișierul de raport din Google Drive / OneDrive.

## Realizări per tehnician

În secțiunea **Echipă**, raportul **Realizări per tehnician** permite selectarea
tehnicianului și perioadei, după **data finalizării**. Sunt incluse numai lucrările
cu statusul `Finalizat`, alocate username-ului selectat. Limitele perioadei includ
ambele zile în fusul `Europe/Bucharest`, inclusiv schimbările de oră.

Fiecare rând prezintă lucrarea, tipul, clientul, data finalizării și totalul
devizului salvat, fără TVA. Nu se recalculează în tăcere tarifele devizelor istorice.
Lucrările fără deviz valid au valoare goală și sunt semnalate; nu se raportează ca
lucrări de zero EUR. Raportul se poate descărca în format `.xlsx`, cu total.

Data finalizării este salvată la închiderea lucrării și păstrată la editările
obișnuite. Redeschiderea lucrării elimină data. Managementul poate introduce sau
corecta data din formularul de editare; nu se acceptă date viitoare.

Pentru intervențiile istorice, migrarea recuperează data validării documentației,
atunci când există. Alte lucrări vechi fără dată sunt listate separat în raport și
nu sunt încadrate arbitrar într-o perioadă. Completează data reală din editarea
lucrării și generează din nou raportul. Migrarea `0007_project_completion.sql`
trebuie aplicată înaintea publicării. Endpointul de raportare este accesibil doar
rolurilor de management, inclusiv pentru tehnicieni inactivi sau istorici.

Migrarea `0006_project_estimates.sql` trebuie aplicată înaintea publicării, prin
comanda D1 de deploy existentă. Accesul este rezervat rolurilor de management.

Validare: `node --test tests/project-budget.test.mjs tests/excel-reports.test.mjs`, `python3 scripts/test-migrations.py`,
`npx wrangler types && npx tsc --noEmit`, `npm run lint`, `npm run build`.
