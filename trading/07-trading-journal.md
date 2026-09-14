# 07 · Trading journal

Vul per trade één regel in `journal.csv` in (zelfde map) en per dag het
dagblok hieronder. Wat je niet meet, verbeter je niet; en het journal is
het enige bewijs dat je strategie een edge heeft vóór je €345 betaalt.

## Kolommen in journal.csv

| Kolom | Vul in |
|---|---|
| datum | 2026-09-15 |
| tijd_open / tijd_dicht | NL-tijd |
| markt | EURUSD, XAUUSD, GER40, BTCUSD |
| setup | A (trend-pullback), B (Londen-breakout), C (range-fade) |
| richting | long / short |
| lots | uit PropRiskCalculator |
| entry / stop / target | prijzen |
| risico_eur | gepland risico (doel €125 – €250) |
| resultaat_eur | netto, inclusief commissie en swap |
| resultaat_R | resultaat_eur / risico_eur |
| regels_gevolgd | 1 – 10 (10 = alle regels) |
| fout | leeg, of: te vroeg, te groot, geen SL, nieuws, revenge, mobiel |
| notitie | wat je zag, wat je voelde, schermafbeelding-bestandsnaam |

## Dagblok (kopieer per dag)

```
## 2026-09-15 (di)
Plan vooraf     : markten, setups, budget (zie 06-marktvooruitblik)
Nieuws          : 08:00 UK jobs · 11:00 ZEW · 14:30 Empire · Fed dag 1
Trades          : 0 / 3       Open risico max: €500
Resultaat       : ___ R  (€___)       Dagbudget over: €___
Regels-score    : __ / 10
Fout van de dag : 
Les             : 
Proces goed?    : ja / nee
```

## Weekoverzicht (vrijdag)

| Week | Trades | Winst% | Gem. winst R | Gem. verlies R | Totaal R | Overtredingen | Equity einde |
|---|---|---|---|---|---|---|---|
| 38 (14–18 sept) | | | | | | | |

Verwachting per trade = winst% × gem. winst R − (1 − winst%) × gem. verlies R.
Ga pas van demo naar challenge bij 30+ trades, verwachting > 0,2R en 0
overtredingen in de laatste 2 weken.
