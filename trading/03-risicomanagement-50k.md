# 03 · Risicomanagement voor een €50.000 account

## 1. De budgetten

| Budget | Firm-limiet (FTMO) | Jouw eigen limiet | Waarom |
|---|---|---|---|
| Per trade | geen | 0,5% = €250 (max 1% = €500) | 7 verliezers op rij blijft onder 4% |
| Open risico tegelijk | geen | 1% = €500 | twee gecorreleerde posities zijn één grote positie |
| Per dag | 5% = €2.500 | 2% = €1.000 | ruimte voor slippage en één fout |
| Per week | geen | 4% = €2.000 | dwingt tot pauze en review |
| Totaal | 10% = €5.000 | 6% = €3.000 → stop en herbeoordeel | je wilt nooit "nog één trade om terug te komen" |

De eigen limieten staan in `PropFirmGuard.mq5` als standaardwaarden.

## 2. Positiegrootte berekenen

Formule:

```
lots = risicobedrag / (stop-afstand in punten × waarde per punt per lot)
```

In MT5 vind je de waarde per punt via **Market Watch → rechtermuisknop →
Specificatie**: `Contract size`, `Tick size`, `Tick value`. Het script
`mql5/PropRiskCalculator.mq5` doet deze berekening automatisch met de
echte symboolgegevens van je broker; gebruik dat boven de tabellen hieronder.

De tabellen gaan uit van een **euro-account** met EUR/USD ≈ 1,16 (koers
van 12 september 2026) en de gebruikelijke FTMO-contractgroottes. Bij een
andere broker of contractgrootte kloppen de getallen niet: controleer altijd.

### EUR/USD (1 lot = 100.000; 1 pip = 0,0001 ≈ $10 ≈ €8,62 per lot)

| Stop (pips) | 0,25% (€125) | 0,5% (€250) | 1% (€500) |
|---|---|---|---|
| 10 | 1,45 lot | 2,90 lot | 5,80 lot |
| 15 | 0,97 | 1,93 | 3,86 |
| 20 | 0,72 | 1,45 | 2,90 |
| 30 | 0,48 | 0,97 | 1,93 |
| 50 | 0,29 | 0,58 | 1,16 |

### GBP/USD (1 pip ≈ $10 ≈ €8,62 per lot; zelfde tabel als EUR/USD)

### XAU/USD goud (1 lot = 100 oz; $1 beweging = $100 ≈ €86,2 per lot)

| Stop ($) | 0,25% | 0,5% | 1% |
|---|---|---|---|
| 5 | 0,29 lot | 0,58 lot | 1,16 lot |
| 10 | 0,14 | 0,29 | 0,58 |
| 15 | 0,10 | 0,19 | 0,39 |
| 20 | 0,07 | 0,14 | 0,29 |
| 30 | 0,05 | 0,10 | 0,19 |

Goud rond $4.350 beweegt gemakkelijk $40 tot $80 per dag. Een stop van
minder dan $10 op een H1-setup is bijna altijd te krap.

### GER40 / DAX (FTMO GER40.cash: 1 lot = €1 per punt; controleer!)

| Stop (punten) | 0,25% | 0,5% | 1% |
|---|---|---|---|
| 30 | 4,2 lot | 8,3 lot | 16,7 lot |
| 50 | 2,5 | 5,0 | 10,0 |
| 80 | 1,6 | 3,1 | 6,3 |
| 120 | 1,0 | 2,1 | 4,2 |

Als je broker 1 lot = €25 per punt hanteert (futures-stijl), deel dan door 25.

### US100 / Nasdaq (1 lot = $1 per punt ≈ €0,862)

| Stop (punten) | 0,25% | 0,5% | 1% |
|---|---|---|---|
| 40 | 3,6 lot | 7,3 lot | 14,5 lot |
| 60 | 2,4 | 4,8 | 9,7 |
| 100 | 1,5 | 2,9 | 5,8 |

### BTC/USD (1 lot = 1 BTC; $1 = $1 ≈ €0,862 per lot)

| Stop ($) | 0,25% | 0,5% | 1% |
|---|---|---|---|
| 300 | 0,48 lot | 0,97 lot | 1,93 lot |
| 500 | 0,29 | 0,58 | 1,16 |
| 1000 | 0,14 | 0,29 | 0,58 |

**Rond altijd naar beneden af** op de lot-stap van de broker.

## 3. Verborgen kosten die je stop groter maken dan je denkt

- **Spread**: op EUR/USD 0,1 tot 0,3 pip, op goud $0,20 tot $0,50, op
  GER40 buiten Xetra-uren (09:00 tot 17:30) vaak 2 tot 5 punten. Tel de
  spread bij je stop op.
- **Commissie**: FTMO rekent ca. $3 per lot per zijde op forex, geen op
  indices. Bij 2 lot EUR/USD kost een rondje $12.
- **Swap**: overnight-rente. Op FTMO-Swing en bij posities over de nacht
  op goud kan dit oplopen; zie Specificatie → Swap long/short.
- **Slippage**: bij nieuws kan een stop 5 tot 30 pips slechter uitvoeren.
  Daarom: nooit vol in positie zitten 2 minuten rond high-impact nieuws.
- **Spreadverbreding om 23:00 CE(S)T** (rollover): stops vlak boven of
  onder de markt worden dan geraakt. Zet stops niet binnen 10 pips tijdens
  rollover of vermijd posities rond dat tijdstip.

## 4. Drawdown-wiskunde

Winst nodig om een verlies goed te maken:

| Verlies | Nodig om terug te komen |
|---|---|
| 2% | 2,04% |
| 5% | 5,3% |
| 10% | 11,1% (op FTMO: account al weg) |
| 20% | 25% |

Waarom herstellen zo veel moeilijker is bij prop firms: het totaalverlies is
vast vanaf €50.000. Sta je op €46.000, dan heb je nog €1.000 "ruimte" en
moet je 8,7% maken met een risico dat je tot 0,1% per trade dwingt. Vanaf
−6% is het rationeel om te stoppen, een nieuwe challenge te kopen en met
volle ruimte te beginnen, in plaats van met €1.000 ruimte te vechten.

## 5. Regels voor open posities

1. **Stop-loss staat in het platform, altijd, direct bij openen.** Geen
   "mentale stop". Op MT5: vul SL in het orderticket in, of gebruik de
   sleepfunctie op de grafiek (Alt+slepen voor SL/TP-lijnen).
2. **Verplaats een stop alleen in de richting van winst.** Nooit een stop
   verruimen.
3. **Bij +1R: stop naar break-even** (of laat de trade lopen volgens je
   getest plan, maar kies vooraf en niet in de trade).
4. **Correlatie telt.** Long EUR/USD + long GBP/USD + short DXY = drie keer
   dezelfde trade. Tel het samen als één positie voor je 1%-limiet.
5. **Geen bijkopen in verlies.** Nooit. Dit is de nummer-1 oorzaak van
   daglimiet-breuken.
6. **Tijdstop**: een setup die na 2 tot 3 keer je gebruikelijke houdtijd
   niets doet, sluit je op de markt. Geld in een dode trade kost kansen.

## 6. Ruïnekans (waarom 0,5% en niet 2%)

Kans om 10% drawdown te raken vóór je 10% winst haalt, bij 45% winstkans
en 2R targets (simulatie-benadering):

| Risico per trade | Kans op 10%-drawdown |
|---|---|
| 0,25% | < 1% |
| 0,5% | ca. 3% |
| 1% | ca. 12% |
| 2% | ca. 35% |
| 3% | > 50% |

Met 2% per trade gooi je een munt op over je challenge-fee. Met 0,5% is de
uitkomst bijna volledig afhankelijk van of je strategie echt een edge heeft,
en dat is precies wat je wilt testen.

## 7. Dagelijkse bewaking in MT5

- Toolbox (Ctrl+T) → tab **Trade** toont Balance, Equity, Margin en de
  open P&L. Equity is wat de firm meet.
- Zet in `PropFirmGuard` je startbalans en limieten; de EA toont
  in de linkerbovenhoek de resterende dag- en totaalruimte.
- Check het **FTMO-dashboard** (client area) minstens eenmaal per dag: dat
  is de enige juridisch geldende meting, inclusief hun berekening van de
  dagstart.
