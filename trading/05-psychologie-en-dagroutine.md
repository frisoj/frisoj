# 05 · Psychologie, dagroutine en de fouten die 86% laten falen

## 1. Waarom mensen zakken (data van 500.000+ prop-traders)

Uit analyses van prop firms zelf (hoc-trade, The Funded Trader, FTMO):

1. **Daglimiet in de eerste week**: de grootste groep valt af binnen 5
   handelsdagen, meestal door één slechte dag met te grote posities of
   bijkopen in verlies.
2. **Verdubbelen na verlies** ("revenge trading"): een herstelbaar verlies
   van 1% wordt een daglimiet-breuk in één positie.
3. **Overtraden**: 8 tot 15 trades per dag op M1/M5 met commissies en
   spread die de edge opeten.
4. **Winnaars te vroeg sluiten, verliezers laten lopen**: gemiddelde winst
   0,6R, gemiddeld verlies 1,4R, ook met 55% winstkans verliesgevend.
5. **Regels niet kennen**: floating verlies dat meetelt in het daglimiet,
   nieuwsrestricties, weekendregels.

Al deze fouten zijn gedrag, niet strategie. Ze worden opgelost met vaste
limieten (`PropFirmGuard`), een vaste routine en een journal.

## 2. Dagroutine (Nederlandse tijd)

| Tijd | Wat | Duur |
|---|---|---|
| 07:30 | Kalender bekijken (MT5 Toolbox → Kalender, of ForexFactory), high-impact events noteren met tijd NL | 5 min |
| 07:40 | H4/H1-bias per markt: trend, niveaus, ATR. Niveaus als lijnen + alerts op de grafiek | 15 min |
| 07:55 | Dagplan invullen (journal-kop): welke setups, waar, hoeveel lots, dagbudget resterend | 5 min |
| 08:00 – 11:00 | Londen-sessie: setup B en A. Meeste beweging op EUR, GBP, GER40, goud | |
| 11:00 – 14:00 | Meestal niets. Scherm dicht is een geldige beslissing | |
| 14:30 – 17:30 | Amerikaanse data (14:30) en open (15:30): setup A op US100, goud, EUR/USD. Geen trades 14:28 tot 14:32 bij data | |
| 17:30 | Posities beoordelen: naar break-even, sluiten of aanhouden volgens plan. Geen nieuwe trades na 17:30 | |
| 18:00 | Journal invullen, schermafbeelding per trade, dagcijfer (R) | 10 min |
| 23:00 | Geen trades open met een stop binnen 10 pips van de markt (rollover) | |

Twee sessies van 2 tot 3 uur. Meer schermtijd geeft meer trades, geen
betere trades.

## 3. Harde regels (bij overtreding: rest van de dag dicht)

1. Stop-loss in het platform vóór de entry.
2. Nooit meer dan 0,5% per trade, 1% open, 2% per dag, 4% per week.
3. Nooit bijkopen in verlies, nooit stop verruimen.
4. Maximaal 3 trades per dag, maximaal 2 open.
5. Na 2 verliezers op rij: 30 minuten pauze, weg van het scherm.
6. Geen trades vanaf mobiel openen.
7. Geen trade zonder ingevulde setupkaart.
8. Alcohol, slaaptekort, ziek, boos: geen handelsdag.

## 4. Mentale technieken die aantoonbaar helpen

- **Denk in R, niet in euro's.** "−1R" doet minder dan "−€250". Zet de
  P&L-kolom in MT5 desnoods uit (Toolbox → Trade → rechtermuis → kolommen).
- **Vooraf accepteren**: bij elke entry zeg je hardop "ik ben bereid €250
  te betalen om te zien of dit werkt". Als dat niet goed voelt, is de
  positie te groot.
- **Proces-score, geen resultaat-score.** Geef jezelf per dag een cijfer
  voor regelnaleving (10 = alle regels gevolgd). Een verliesdag met een 10
  is een goede dag; een winstdag met een 6 is een slechte dag.
- **Reeksen zijn normaal.** Bij 45% winstkans komt 5 verliezers op rij eens
  per 100 trades voor. Het betekent niets over jou.
- **Het account is niet van jou.** Je huurt kapitaal. Uitbetaalde winst is
  de enige echte winst. Wees bereid het account te verliezen aan de regels,
  nooit aan één trade.

## 5. Wekelijkse review (vrijdag 18:00, 30 minuten)

1. MT5 → History → Rapport exporteren.
2. Per setup: aantal trades, winstkans, gemiddelde R, totaal R.
3. Aantal regelovertredingen (doel: 0).
4. De beste en de slechtste trade met schermafbeelding: wat was het
   verschil in uitvoering?
5. Eén ding dat je volgende week anders doet. Niet drie.
6. Dag- en weekbudget resetten, `PropFirmGuard` controleren.

## 6. Wanneer stoppen met een challenge

- Bij −6% totaal: stop. De resterende 4% ruimte dwingt tot te kleine
  posities; een nieuwe challenge met volle ruimte heeft meer kans.
- Bij 3 regelovertredingen in een week: terug naar demo voor 2 weken.
- Bij een negatieve verwachting over 40+ trades: de strategie, niet jij,
  is het probleem. Terug naar de tester.
