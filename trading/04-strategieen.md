# 04 · Drie setups die passen bij prop-firm regels

Uitgangspunten: weinig trades, duidelijke stop, target minimaal 2R, geen
handel 2 minuten rond high-impact nieuws, geen posities die het daglimiet
kunnen bedreigen. Kies **één** setup en **één of twee markten**, handel die
minstens 30 keer op demo, en voeg pas daarna iets toe.

Markten die goed passen bij een euro-account op FTMO: EUR/USD, GBP/USD,
XAU/USD, GER40. US100 en BTC alleen met kleinere risico's (0,25%) door de
grotere slippage.

## Setup A · Trend-pullback op H1/M15 (basis voor alles)

**Wanneer**: H4 en H1 in dezelfde richting (prijs boven stijgende EMA 50 en
EMA 20 > EMA 50 voor long; omgekeerd voor short). ADX(14) op H1 boven 20.

**Entry**:
1. Prijs trekt terug naar de zone tussen EMA 20 en EMA 50 op H1, of naar
   de 38,2 tot 61,8% Fibonacci van de laatste impuls.
2. Op M15 vormt zich een afwijzing: pin bar, engulfing, of een lagere
   low die niet doorzet, gevolgd door een close terug boven de EMA 20 (M15).
3. Entry op de close van die M15-candle (market) of een buy-limit op 50%
   van die candle.

**Stop**: onder de swing-low van de pullback + 1 × ATR(14) op M15, minimaal
de spread + 3 pips. Typisch 15 tot 30 pips EUR/USD, $10 tot $20 goud, 40 tot
80 punten GER40.

**Target**: 2R vast, of 1R sluiten bij de vorige hoogste top en de rest
naar 3R. Stop naar break-even bij +1R.

**Niet handelen als**: het nieuwste H1-swingpunt binnen 30 minuten voor
high-impact nieuws is ontstaan; de pullback dieper gaat dan 78,6%; ADX < 20.

**Verwachting bij correcte uitvoering**: 40 tot 50% winstkans bij 2R, dus
0,2 tot 0,5R per trade. Tijd: 1 tot 2 trades per dag over 3 markten.

## Setup B · Londen-open breakout op GER40 en EUR/USD

**Wanneer**: elke werkdag zonder high-impact EU-nieuws tussen 08:00 en 10:00.

**Voorbereiding (07:50 NL-tijd)**:
1. Markeer de high en low van 02:00 tot 08:00 (Aziatische range) op M15.
2. Range moet tussen 0,5 en 1,5 × dag-ATR(14)/3 zijn: te klein = geen
   vervolg, te groot = al uitgebroken.

**Entry**:
- Buy stop 2 punten boven de range-high, sell stop 2 punten onder de
  range-low, geldig tot 10:30 ("Vandaag" + handmatig verwijderen om 10:30).
- Zodra één kant vult, verwijder de andere direct (OCO doet MT5 niet
  automatisch; `PropFirmGuard` heeft er een optie voor).
- Op GER40 vanaf 09:00 (Xetra-open) de meest betrouwbare, op EUR/USD vanaf 08:00.

**Stop**: het midden van de range (bij een normale range) of de andere kant
van de range bij een kleine range. Maximaal je 0,5%-budget: anders de order
kleiner of overslaan.

**Target**: 1,5 × range-hoogte, of 2R. Bij een breakout die binnen 15
minuten terug in de range sluit: direct eruit (false breakout), niet wachten
op de stop.

**Niet handelen als**: FOMC/ECB/CPI-dag (zoals 16 september 2026), of
Aziatische range groter dan 60% van de dag-ATR.

## Setup C · Range-fade op goud aan een bevestigd niveau

**Wanneer**: goud consolideert (ADX H4 < 20) tussen duidelijke niveaus, zoals
half september 2026 tussen ca. $4.260 en $4.470.

**Entry**: prijs raakt de range-rand op H1, vormt een afwijzingscandle
(wick minstens 2 × het lichaam) en de volgende H1-candle sluit terug in de
range. Entry op die close.

**Stop**: boven/onder de wick + $3 tot $5. Typisch $10 tot $20.
**Target**: het midden van de range (1R tot 1,5R), en bij sterke afwijzing
de andere kant (3R). Neem minimaal 50% van de positie bij het midden.

**Niet handelen als**: een centrale bank (Fed) binnen 24 uur besluit, tenzij
je positie klein genoeg is (0,25%) om een $60-gap te overleven binnen je
dagbudget. In de Fed-week van 15 september is dit een setup voor dinsdag
tot en met de ochtend van woensdag, met alles dicht vóór 20:00 woensdag.

## Wat je niet doet

- **Nieuws-scalpen** (in de release springen): slippage en spread eten je
  edge op; op funded Normal-accounts is het verboden in de 2-minuten-zone.
- **Martingale / bijkopen in verlies**: de directe route naar het daglimiet.
- **Grid- en hedge-EA's** van internet: bijna alle prop-firm-blowups van
  EA's komen hiervandaan.
- **Meer dan 3 trades per dag**: na drie ben je aan het gokken, niet handelen.
- **Wisselen van setup na twee verliezers**: elke setup heeft reeksen van
  5 tot 7 verliezers; alleen het journal over 30+ trades zegt iets.

## Setupkaart (print of zet naast je scherm)

```
1. Trend H4/H1 bepaald?                 ja / nee → nee = niets doen
2. Nieuws binnen 30 min?                ja = wachten
3. Setup A/B/C exact zoals beschreven?  nee = geen trade
4. Stop-afstand in punten: ____         lots (script): ____
5. Risico ≤ €250 en totaal open ≤ €500? nee = kleiner of overslaan
6. Dagverlies tot nu: €____ (limiet €1.000)
7. SL en TP ingevuld in ticket?         → pas dan op "Kopen/Verkopen"
```
