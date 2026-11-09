# Raport zilnic per tehnician

Disponibil managementului în Echipă, sub raportul existent de realizări.
Se selectează tehnicianul și o zi (De la = Până la) sau o perioadă.

## Date și alocare

- Manoperele se datează separat după ultima fotografie încărcată de tehnician
  pentru manopera respectivă. Se alege fotografia după momentul încărcării,
  apoi se folosește data ei salvată (`captured_at`), în Europe/Bucharest.
  Data încărcării este rezervă pentru fotografiile fără dată salvată.
- Fotografiile sunt citite înainte de filtrarea perioadei. O manoperă cu o poză
  mai nouă în altă zi nu se repetă în rapoartele zilelor anterioare.
- Intervențiile sunt asociate prin ID-ul activității din categoria fotografiei.
  Joncțiunile/sudurile folosesc ID-urile înregistrărilor de sudură ale joncțiunii.
  Traseul FO, clientul și site-ul au fotografii comune pe secțiune; nu există
  dată separată pe segment/echipament în modelul actual.
- Sunt folosite numai imaginile încărcate de tehnicianul selectat. Operațiunile
  lui pot fi găsite și pe proiecte realocate ulterior altui tehnician.
  Fotografiile managementului, documentele și pozele de siguranță nu datează
  manoperele.
- Orange/OROC folosește `work_date` și tehnicianul alocat tichetului.
- Operațiunile fără fotografie asociată (inclusiv manopere manuale fără o
  asociere salvată) se listează separat, fără atribuire arbitrară unei zile.
  Această listă nu poate fi filtrată după perioadă.
- Raportul anterior de realizări păstrează regulile existente; nu este înlocuit.

## Conținut și valori

Manoperele provin din devizul salvat sau, în absența lui, din documentația de
teren folosind aceleași reguli BoQ. Materialele sunt excluse. Cantitățile
necompletate sunt marcate explicit; manoperele din secțiuni fără intervenție
nu primesc o dată prin poze vechi. Devizele/documentațiile invalide sunt semnalate.

Pentru fiecare zi apar cantitățile grupate după manoperă/BoQ/pachet și UM,
detaliile pe lucrare/tichet, totalul și numărul pozițiilor fără valoare.
Valorile manoperelor sunt confirmate numai dacă există deviz salvat.
SP2 FOA are 300 EUR/tichet; celelalte pachete nu au tarif configurat.
Pozițiile incluse în alt pachet au valoare zero, fără dublă facturare.
Totalurile se adună din valorile rotunjite pe poziție, fără TVA.

Exportul Excel are două foi: `Raport zilnic` pentru teren și `Orange OROC`
pentru tichete. Fiecare lucrare/tichet apare o singură dată pe foaia sa, inclusiv
când perioada conține manopere din mai multe zile. Datele, manoperele și
cantitățile sunt păstrate în celule pe linii separate. O dată unică este
exportată ca dată Excel; datele multiple sunt enumerate.

Foaia principală conține total teren, total Orange/OROC (formulă care referă
a doua foaie) și total general. Valorile neconfigurate rămân goale, iar
lucrările cu valori incomplete sunt marcate. Manoperele fără dată sunt
menționate pe aceeași linie a lucrării și excluse din valoare. O lucrare
numai cu manopere nedatate are valoarea goală. Totalurile nu includ de
două ori detaliile și rămân valide când una dintre foi nu are lucrări.
Interfața păstrează sumarul pe zile și detaliile pe manopere.
