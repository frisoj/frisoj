# review/pdfcheck/ — controle van de pdf

Numeriek bewijsmateriaal, geen bewijs. Deze map bevat de scripts en uitkomsten van de
controle van `REPORT.pdf`. De controle is gedaan op de eerste bouw van de pdf ("v1", 44
pagina's), door drie afzonderlijke controles van hetzelfde AI-systeem dat ook het rapport
heeft gemaakt. Geen mens heeft de pdf nagekeken.

| bestand of map | inhoud |
|---|---|
| `findings_v1.txt` | de volledige bevindingen van de drie controles, met per bevinding de ernst, de plaats, het bewijs en de voorgestelde wijziging |
| `numbers/` | getallencontrole: elk getal van bijlage B tegen `results/*.json` (`check_b.py`), de titelpagina en de verificatietabel tegen de bewijsstukken (`check_front.py`), alle getallen en tabellen van het rapport in de pdf tegen `REPORT.md` (`check_tokens.py`, `cmp_tables.py`, `check_allnums*.py`), de vingerafdrukken van bijlage C (`out_c.txt`), en de uitvoer daarvan (`out_*.txt`) |
| `layout/` | opmaakcontrole: scripts die nagaan of tekst buiten de bladspiegel valt, of bestandsnamen en getallen heel blijven en of de tekstlaag klopt (`geom.py`, `codecheck.py`, `textcheck.py`, ...), en de wijzigingen in de opmaak (`style.diff`) |

## Wat de controle van v1 opleverde

- **Getallen.** Geen enkel fout getal. In bijlage B klopten 732 van de 733 vergelijkingen
  met de resultaatbestanden; de ene afwijking was geen fout getal maar een cel die een
  waarde toonde waar "geen meting" hoort te staan (m/√σ volgens R5 op d3_b6.0_L24). In de
  tekst van het rapport kwamen alle 516 getallen met fout en alle 771 tabelcellen
  ongewijzigd in de pdf terecht.
- **Opmaak.** Negen opmaakfouten, waaronder afgekapte lijstnummers en gebroken
  bestandsnamen; hersteld in `pdf/style.css`.
- **Formulering.** Geen zin die een bewijs of een oplossing claimt, maar de nieuwe
  onderdelen (titelpagina, verificatie, bijlage B en C) zeiden op tien plaatsen meer dan
  de bewijsstukken dragen. Voorbeelden: "124 waarden in §4.8" terwijl 103 daarvan bij
  §4.8 horen; "271 automatisch teruggevonden" terwijl 257 letterlijk zijn teruggevonden;
  de tweede simulatie rekent de glueballmassa's niet na; en dat geen mens het werk heeft
  nagekeken stond te ver naar achteren.

Al deze punten zijn daarna in `pdf/make_pdf.py`, `pdf/style.css` en `pdf/print_pdf.js`
verwerkt. De scripts in deze map verwijzen naar de bevroren kopie van v1 in een tijdelijke
werkmap; om ze op een latere bouw te draaien moet dat pad worden aangepast.
