# Orange/OROC

Secțiunea se găsește în **Activități → Orange/OROC**, inclusiv în navigarea mobilă.
Este disponibilă coordonatorilor, managerilor și administratorilor. Tehnicienii
nu pot accesa lista sau modifica înregistrările prin interfață ori API.

Pentru fiecare tichet se introduc:

- **Număr tichet**: text, normalizat la majuscule; zerourile de la început se păstrează.
- **Data**: dată calendaristică, fără schimbarea zilei prin conversii de fus orar.
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
Editarea permite corectarea tuturor celor trei câmpuri. Numerele duplicate sunt
respinse atât de API, cât și de constrângerea unică din baza de date. Se păstrează
autorul și momentul creării, respectiv ale ultimei modificări.

Înregistrarea este separată de proiectele de instalare: nu cere client, CPE,
contact sau documentație Pretask pentru simpla înregistrare a celor trei câmpuri.
Această versiune nu atribuie un tehnician și nu generează automat un deviz/QAF.

Înainte de publicare trebuie aplicată migrarea `0010_orange_oroc_tickets.sql` prin
comanda D1 de deploy existentă. Catalogul conține numai datele generice din Services;
fișierul incidentului atașat nu este publicat în repository.

Verificări: `node --test tests/orange-oroc.test.mjs`, `python3 scripts/test-migrations.py`,
`npx tsc --noEmit`, lint și build de producție.
