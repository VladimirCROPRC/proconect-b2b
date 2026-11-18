# Centralizator tehnicieni

`Reporting b2b.xlsx` este generat din datele aplicației în folderul OneDrive
configurat. Fiecare cont cu rol Tehnician are o foaie separată. Foile păstrează
și realizările tehnicienilor inactivi pentru istoric. Centralizatorul însumează
valorile Vodafone, Orange/OROC și totalul fiecărui tehnician.

Sunt preluate numai manoperele selectate din devizele salvate ale instalărilor
Vodafone și tichetele Orange/OROC alocate tehnicienilor. Prețurile din deviz
sunt păstrate inclusiv când aceeași manoperă are prețuri diferite între lucrări.
SP2 FOA are tarif 300 EUR. Celelalte pachete Orange sunt marcate cu tarif lipsă
și numărate separat în centralizator. Materialele sunt excluse.

Data Vodafone este data ultimei fotografii asociate manoperei, încărcate de
tehnicianul alocat. O linie adăugată manual în deviz preia data ultimei fotografii
a aceleiași lucrări și aceluiași tehnician. Manoperele fără fotografie datată
sunt excluse, conform regulii rapoartelor zilnice. Pentru Orange se folosește data
tichetului. Fiecare pereche lucrare/dată ocupă o coloană în foaia tehnicianului.

Pentru activare pe Ubuntu, în `.env.selfhost` se setează
`PROCONECT_REPORTING_ENABLED=1`. Destinația de salvare din aplicație trebuie să fie
OneDrive sau Google Drive + OneDrive. La activare se generează fișierul cu datele
curente. Serverul verifică modificările la 30 de secunde și programează o refacere
după modificarea datelor sau crearea unui utilizator. Există și o refacere zilnică
la 23:55 Europe/Bucharest. Sarcinile eșuate rămân în coadă pentru reîncercare.

Fișierul comun este înlocuit integral la fiecare sincronizare. Corecțiile se fac
în aplicație, deoarece modificările manuale în Excel sunt suprascrise. Recalcularea
completă preia și modificările devizelor vechi, fără acumularea unor copii ale
acelorași realizări. Actualizările trec prin coada OneDrive cu blocarea existentă,
iar fișierul are întotdeauna același nume.

Administratorul poate descărca varianta actuală din
`/api/reporting-workbook`, după autentificarea în aplicație.
