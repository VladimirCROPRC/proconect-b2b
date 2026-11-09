# Orange/OROC

Secțiunea se găsește în **Activități → Orange/OROC**, inclusiv în navigarea mobilă.
Coordonatorii, managerii și administratorii pot crea, edita și aloca tichete.
Tehnicienii văd numai tichetele alocate username-ului lor, fără drept de editare.
Aceste limite sunt aplicate și în API, nu doar în interfață.

Pentru fiecare tichet se introduc:

- **Număr tichet**: text, normalizat la majuscule; zerourile de la început se păstrează.
- **Data**: dată calendaristică, fără schimbarea zilei prin conversii de fus orar.
- **Tehnician alocat**: selecție obligatorie dintre tehnicienii activi. Alocarea
  poate fi schimbată prin editare; după realocare, tichetul dispare din lista
  fostului tehnician și apare la noul tehnician.
- **Pachet de servicii**: o selecție din cele șapte pachete principale din QAF,
  foaia `Services`, rândurile 4–10.

| Cod original | Pachet |
| --- | --- |
| SP1 FO | Reparații în locație (ODF / patch) |
| SP2 FOA | Aerian, fără cablu nou |
| SP3 FOA | Aerian, cablu nou sub 200 m |
| CR4 FOA | Aerian, cablu nou peste 200 m |
| SP5 FOU | Subteran, cablu până la 100 m |
| CR6 FOU | Subteran, cablu nou 100–300 m |
| CR7 FOU | Subteran, cablu nou peste 300 m |

Codurile CR4/CR6/CR7 sunt păstrate exact din sursă. Descrierea completă originală
poate fi consultată sub selector. Pozițiile suplimentare din Services și cantitatea
completată în exemplul QAF nu sunt transformate în pachete sau valori implicite.
Nu se importă detaliile incidentului sau foile cu nume din QAF.

Tichetele sunt salvate permanent și pot fi căutate după număr, dată sau pachet.
Editarea permite corectarea datelor și schimbarea tehnicianului. Numerele duplicate sunt
respinse atât de API, cât și de constrângerea unică din baza de date. Se păstrează
autorul și momentul creării, respectiv ale ultimei modificări.

Înregistrarea este separată de proiectele de instalare: nu cere client, CPE,
contact sau documentație Pretask pentru simpla înregistrare a celor trei câmpuri.
Înregistrarea tichetului nu generează automat un deviz/QAF. Câmpul pentru numărul
tichetului este gol la creare și nu are placeholder.

Tichetele vechi fără tehnician sunt marcate «Nealocat» și pot fi alocate din
«Editează». Nu se atribuie automat unei persoane alese arbitrar. O alocare
istorică către un tehnician devenit inactiv poate fi păstrată la editarea altor
date; alocările noi sunt permise numai către tehnicieni activi.

Înainte de publicare trebuie aplicate migrările `0010_orange_oroc_tickets.sql`
și `0011_orange_ticket_technician.sql` prin
comanda D1 de deploy existentă. Catalogul conține numai datele generice din Services;
fișierul incidentului atașat nu este publicat în repository.

Verificări: `node --test tests/orange-oroc.test.mjs`, `python3 scripts/test-migrations.py`,
`npx tsc --noEmit`, lint și build de producție.

Tichetele alocate apar și în raportul pe tehnician și în exportul Excel,
filtrate după data execuției introdusă în tichet (`work_date`), inclusiv pentru
tichete create ulterior. Proiectele folosesc în continuare data creării.
Raportul afișează numărul tichetului și pachetul de servicii.
SP2 FOA are tarif de 300 EUR/tichet, inclus în total și în Excel.
Celelalte pachete apar «Fără valori», cu celula valorii goală; nu intră în
avertizarea privind devizele lipsă ale proiectelor.
