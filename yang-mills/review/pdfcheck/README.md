# review/pdfcheck/ — controle van de pdf

Numeriek bewijsmateriaal, geen bewijs. Deze map bevat de scripts en bevindingen van de
controles van `REPORT.pdf`. Alle controles zijn gedaan door hetzelfde AI-systeem dat ook het
rapport en de pdf heeft gemaakt, in afzonderlijke controlerondes. Geen mens heeft de pdf
nagekeken.

De pdf is vier keer gebouwd. Hieronder staat per bouw wat er is nagelopen en wat niet.

| bestand of map | inhoud |
|---|---|
| `findings_v1.txt` | bevindingen van de drie controles van de eerste bouw (getallen, opmaak, formulering) |
| `findings_v2.txt` | bevindingen van de controle van de formulering van de tweede bouw |
| `findings_v3.txt` | bevindingen van de drie controles van de derde bouw (getallen, opmaak, gewijzigde zinnen) |
| `numbers/` | scripts en uitvoer van de getallencontrole van de eerste bouw |
| `numbers_final/` | scripts en uitvoer van de getallencontrole van de **definitieve** bouw (`run_all.sh` noemt de opdrachten, `out_*.txt` bevat de uitvoer) |
| `layout/` | scripts van de opmaakcontrole en de wijzigingen in de opmaak (`style.diff` na de eerste bouw, `style_v3_layout.diff` na de derde) |

## De definitieve bouw

De `REPORT.pdf` in deze repository is de vierde bouw: 42 pagina's, gebouwd op 13 november
2026, SHA-256 `0e812cfc53849e0e834de655867523b0ad656a527377d5ed6d2a29aa5e1e5fa4`.

Wat op deze bouw zelf is nagelopen (uitvoer in `numbers_final/`):

- **Bijlage B:** alle getallen van de 13 analyses tegen `results/<ensemble>.json` en
  `results/independent/<ensemble>.json`: 733 van 733 vergelijkingen kloppen; "geen plateau"
  en "geen meting" staan precies waar de bestanden dat aangeven (119 van 119).
- **Tekst van het rapport:** alle 274 verschillende getallen met fout komen even vaak voor
  als in `REPORT.md`; alle 13 tabellen zijn gelijk (771 cellen); na het terugdraaien van de
  drie aangekondigde wijzigingen is het rapportdeel byte voor byte gelijk aan `REPORT.md`.
- **Titelpagina en verificatie:** alle aantallen tegen de bewijsstukken: 177 van 177
  vergelijkingen kloppen. Het controlescript citeert de zinnen waarin de aantallen staan;
  die citaten zijn voor deze bouw aangepast aan de gewijzigde formulering.
- **Inhoudsopgave, voetregels, tekstlaag, figuren:** de paginanummers van alle 12 ingangen
  kloppen, de voetregel klopt op alle 42 pagina's, vijf manieren om de tekst uit de pdf te
  lezen geven dezelfde getallen, en de figuren zijn pixel voor pixel die uit `results/`.
- **Met het oog:** de pagina's die sinds de derde bouw zijn veranderd (titelpagina,
  verificatie, de inleiding van bijlage B, bijlage C).

Wat op deze bouw niet opnieuw is gedaan: een aparte leesronde van de formulering. De
verschillen met de derde bouw zijn de tekstwijzigingen die de controle van de derde bouw zelf
voorstelde (`findings_v3.txt`, onderdeel "pdf-wording-delta-v3") en de datumregel op de
titelpagina. De volledige testsuite is voor de pdf niet opnieuw gedraaid; de code is sinds de
laatste run niet veranderd, op tekencode in `summarize.py` na.

## De eerdere bouwen

- **Eerste bouw (44 pagina's).** Drie controles: getallen, opmaak, formulering. Geen enkel
  fout getal. In bijlage B klopten 732 van de 733 vergelijkingen; de ene afwijking was geen
  fout getal maar een cel die een waarde toonde waar "geen meting" hoort te staan (m/√σ
  volgens R5 op d3_b6.0_L24). Negen opmaakfouten, waaronder afgekapte lijstnummers en
  gebroken bestandsnamen. De nieuwe onderdelen (titelpagina, verificatie, bijlage B en C)
  zeiden op tien plaatsen meer dan de bewijsstukken dragen; bijvoorbeeld "124 waarden in
  §4.8" terwijl 103 daarvan bij §4.8 horen, en "271 automatisch teruggevonden" terwijl 257
  letterlijk zijn teruggevonden. Deze punten zijn verwerkt, op vier opmaakpunten na: de
  kleine tekst in de figuren, witruimte onderaan sommige pagina's, de bronregel van tabel 1
  die op de volgende pagina valt, en de voetregel op de titelpagina.
- **Tweede bouw (42 pagina's).** Titelpagina, hoofdstuk "Verificatie" en de inleidingen van
  bijlage B en C waren herschreven. Alleen de controle van de formulering is afgemaakt: geen
  zin die een bewijs of een oplossing claimt, wel acht zinnen die iets meer zeiden dan de
  bewijsstukken. De controles van de getallen en de opmaak zijn in die ronde afgebroken door
  een gebruikslimiet.
- **Derde bouw (42 pagina's).** Drie controles. Getallen: alles klopt, nul afwijkingen.
  Opmaak: drie kleine punten hersteld in `pdf/style.css`; over blijven de vier hierboven
  genoemde punten en een ongelijke kolomverdeling in de verificatietabel. Gewijzigde zinnen:
  geen te sterke beweringen; vier zinnen waren onnauwkeurig of onvolledig (één zei minder
  dan er was gedaan) en zijn in de definitieve bouw aangepast.

## Let op bij opnieuw draaien

- De scripts in `numbers/` en `numbers_final/` verwijzen naar bevroren kopieën van de pdf in
  een tijdelijke werkmap; om ze op een andere bouw te draaien moet dat pad worden aangepast.
- `review/numcheck/trace_tokens.py` leest alle `review/*/*.txt`. Sinds de bestanden
  `findings_v*.txt` hier staan, vindt dat script de daar aangehaalde getallen letterlijk
  terug en meldt het "0 niet herleid". De uitvoer in
  `review/numcheck/out_final/trace_tokens.txt` (257 letterlijk, 14 zwak, 2 met de hand) is
  van vóór die bestanden en is de juiste; draai dat script niet opnieuw zonder deze map uit
  te sluiten.
