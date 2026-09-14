# 14 · Pinterest bulkupload — 30 pins in één keer

Pinterest kan tot 200 pins tegelijk aanmaken en inplannen vanuit één CSV-bestand.
Dat bestand staat klaar: `marketing/pinterest-bulk-upload.csv`. Je uploadt het één
keer en daarna verschijnen de pins vanzelf, verspreid over vier weken.

## Wat er al klaar staat

- **De 30 pinafbeeldingen staan in Shopify Files**, elk 1000 × 1500 px met een
  Nederlandse alt-tekst. De CSV verwijst naar die publieke adressen, dus je hoeft
  geen enkele afbeelding zelf te uploaden.
- **De catalogus staat op het Pinterest-kanaal.** Alle zes producten (inclusief de
  gratis weekplanner) zijn gepubliceerd op het verkoopkanaal Pinterest; daar maakt
  Pinterest zelf productpins van. Dat staat los van de 30 pins hieronder.

## Stap 1 — maak eerst de acht borden aan

Dit moet vóór de upload. Een regel waarvan het bord niet bestaat, mislukt.
De namen moeten **exact** kloppen:

1. Digitale planner Nederlands
2. Budget en sparen
3. Printables en weekplanners
4. ChatGPT en AI prompts Nederlands
5. Planning en overzicht
6. Gewoontes en routines
7. Rust in je hoofd
8. Plannerij · nieuw in de winkel

De bordbeschrijvingen om te plakken staan in `02-pinterest.md`, punt 1.

## Stap 2 — upload de CSV

Pinterest → Maken → **Pins in bulk maken** → sleep `pinterest-bulk-upload.csv` in
het vak. Pinterest laat een voorbeeld zien van wat het inleest; controleer een
paar regels en bevestig.

De kolommen zijn `board_name, title, description, link, image_url, published_at`.
Klaagt Pinterest over de kopregel? Download dan hun eigen voorbeeldbestand in dat
scherm en vergelijk de kolomnamen; Pinterest verandert die af en toe. Alleen de
eerste regel hoeft dan aangepast.

## Stap 3 — controleer de planning

De pins staan ingepland van **15 september tot en met 12 oktober 2026**, één per
dag om 19:30, met twee dagen die er een tweede pin bij hebben om 12:30. Ze zijn
bewust afgewisseld over de vijf producten, zodat niet drie dagen achter elkaar
dezelfde soort pin voorbijkomt.

Pinterest kijkt ongeveer 30 dagen vooruit. Wil je later beginnen of opnieuw
plannen:

```bash
python3 generators/pinterest_csv.py 2026-10-15
```

Dat schrijft dezelfde CSV met een nieuwe startdatum. Wil je juist alles meteen
online? Verwijder dan de kolom `published_at`; Pinterest publiceert de pins dan
direct — maar 30 pins op één dag werkt minder goed dan verspreid.

## Daarna

- **Claim je website** (Instellingen → Geclaimde accounts → Website). Dan staat je
  merknaam onder elke pin die iemand van je site opslaat en zie je statistieken.
- **Meet wat het oplevert**: plak `?utm_source=pinterest&utm_medium=social&utm_campaign=bulk1`
  achter de links als je een volgende ronde maakt. Je ziet het terug in Shopify →
  Analytics → Sessies per verwijzing.
- **Nieuwe pins maken**: `generators/pins.py` bouwt de afbeeldingen,
  `generators/pinterest_csv.py` bouwt de CSV. De teksten komen uit
  `02-pinterest.md` en `08-pins-uploadlijst.md`.

## Als je liever handmatig begint

`13-eerste-10-pins.md` bevat tien pins met titel, beschrijving, link en bord in
losse blokjes om te kopiëren. Dat is bedoeld als je eerst wilt zien hoe het
eruitkomt voordat je alle dertig in één keer plant.
