# QA-rapport productbestanden (13 september 2026)

Automatische controle met pymupdf en de generatorcode (`calendar_data.py`), plus visuele
steekproeven van de gerenderde pagina's.

## Digitale Planner 2027 – groen
- 85 pagina's, 53 weekpagina's (week 53 van 2026 t/m week 52 van 2027), geen ontbrekende weken.
- Datumbereik op elke weekpagina klopt met de ISO-kalender (0 afwijkingen).
- 1.947 interne hyperlinks, allemaal naar een bestaande pagina; steekproef: datum 15 januari op
  de maandpagina springt naar de pagina van week 2.
- Alle feestdagen (NL + BE, Moederdag/Vaderdag/Sinterklaas) komen voor in de tekst; Pasen 2027 =
  28 maart, Goede Vrijdag 26 maart, Hemelvaart 6 mei, Pinksteren 16 mei.
- Geen ontbrekende glyphs (0 vervangingstekens); pijlen zijn vervangen door knoppen "vorige"/"volgende".

## Printbare Planner A4/A5 – groen
- Zelfde kalenderdata en feestdagen als de digitale editie; 82 pagina's; A5 is een exacte schaling.

## Printable Bundel A4/A5 – groen
- 13 pagina's; twee overlappende kopteksten ("Datum"/"Maand") en de weekendrijen van de
  maaltijdplanner zijn tijdens de bouw al gecorrigeerd.

## Budgetplanner (xlsx) – groen met kanttekening
- 19 tabbladen, 1.489 formules; statische check: alle verwijzingen naar bestaande bladen/cellen,
  alleen functies die Excel, Google Sheets en Numbers ondersteunen. Formules zijn met een
  Python-evaluator doorgerekend op lege en gevulde testdata.
- Kanttekening: het bestand bevat geen gecachede formulewaarden; Excel/Sheets rekenen bij openen
  zelf (normaal gedrag). Numbers toont soms geen keuzelijst die naar een ander blad verwijst;
  typen blijft werken.

## AI Prompt Pack – groen
- 200 prompts, 0 dubbele titels, 10 categorieën × 20; PDF 66 pagina's met inhoudsopgave;
  CSV UTF-8 met BOM, 200 rijen × 5 kolommen.

## Aanbevolen vervolgcontrole door de merchant
- Open de digitale planner één keer in GoodNotes of Notability en tik door 3 tabbladen.
- Open de budgetplanner in Excel én Google Sheets en vul één maand in.
