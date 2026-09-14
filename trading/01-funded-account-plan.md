# 01 · Funded account €50.000: keuze, regels en stappenplan

## 1. Hoe een prop-firm challenge werkt

Je betaalt een eenmalige fee, handelt op een demo-account met echte
marktprijzen en moet een winstdoel halen zonder de verliesgrenzen te raken.
Daarna krijg je een "funded" account: de firm draagt het kapitaal, jij krijgt
een winstdeel (meestal 80 tot 90%). Verlies je op het funded account meer dan
de limiet, dan is het account weg en begin je opnieuw (met een nieuwe fee).

Wat je in feite koopt: **een hefboom op je discipline**. Het bedrijfsmodel
van prop firms draait op het feit dat de meeste mensen de regels breken.

## 2. Vergelijking voor een €50k account (stand september 2026)

| | FTMO | FundedNext (Stellar 2-step) | The5ers |
|---|---|---|---|
| Fee 50k | €345 (terugbetaald bij eerste payout) | ca. $300 (Stellar), $230 (Stellar Lite) | varieert per programma |
| Doel fase 1 / 2 | 10% / 5% (meerdere bronnen melden 8% / 5% in 2026; check bij aankoop) | 8% / 5% (Stellar); Lite 8% / 4% | milestone-model |
| Daglimiet | 5% (€2.500) | 5% (Lite: 4%) | tot 4% totaal, dus zeer krap |
| Max verlies | 10% (€5.000), vast vanaf startbalans | 10% (Lite: 8%), vast | 4% |
| Minimum handelsdagen | 4 per fase | 5 (Stellar) | geen tijdslimiet |
| Winstdeel | 80%, tot 90% via scaling | 85%, plus 15% van challenge-winst | begint op 50%, groeit naar 100% |
| Platforms | MT4, MT5, cTrader, DXtrade | MT4, MT5, cTrader | MT5 |
| Tijdslimiet | geen (sinds 2023) | geen | geen |

**Advies: FTMO, in euro, op MT5.** Reden: tien jaar zonder schandalen,
betrouwbare payouts, geen tijdslimiet, gratis herkansing als je fase 1 in
winst afsluit maar het doel niet haalt, en een Swing-variant zonder
nieuws- en weekendrestricties. FundedNext is goedkoper en betaalt 15% van
je challenge-winst uit; een goede tweede optie als budget doorslaggevend is.

## 3. De FTMO-regels voor €50.000 in detail

| Regel | Waarde | Hoe berekend |
|---|---|---|
| Winstdoel fase 1 (Challenge) | €5.000 (10%) of €4.000 (8%) | gesloten winst op einde |
| Winstdoel fase 2 (Verification) | €2.500 (5%) | idem |
| Maximaal dagverlies | €2.500 (5%) | vanaf de **balans van middernacht CE(S)T** de dag ervoor, inclusief **open (floating) verlies** en swaps/commissies |
| Maximaal totaalverlies | €5.000 (10%) | equity mag nooit onder €45.000; vast, trailt niet mee met winst |
| Minimum handelsdagen | 4 per fase | een dag telt als je minstens één positie opent |
| Tijdslimiet | geen | |
| Hefboom (Normal) | 1:100 forex, 1:50 indices, lager voor exotische indices | Swing: 1:30 forex, 1:15 indices |
| Nieuws (alleen funded, Normal) | geen openen/sluiten 2 min voor en na high-impact nieuws op het betreffende instrument, ook SL/TP tellen | Swing: geen restrictie |
| Weekend (funded, Normal) | posities sluiten voor het weekend | Swing: mag aanhouden |
| Winstdeel | 80%, 90% via Scaling Plan | payout op aanvraag, standaard elke 14 dagen |
| Verboden | latency/arbitrage, kopiëren van andermans FTMO-accounts, hedgen over accounts heen, gokgedrag (alles in één trade) | |

**Let op het daglimiet-mechanisme.** Als je gisteren sloot op €51.000, is je
daglimiet vandaag €48.500. Sta je om 15:00 met €1.900 open verlies en
€700 gerealiseerd verlies, dan ben je op €2.600 en is het account weg, ook
al zou de trade later herstellen. Daarom: je stop-loss telt altijd mee in
je dagbudget.

**Kies Swing als je posities over nieuws of het weekend wilt houden.** De
lagere hefboom (1:30) is voor een 0,5%-risicostijl volkomen voldoende: je
gebruikt hooguit een paar procent van de beschikbare margin.

## 4. Wiskunde van het winstdoel

Alles in R (1R = het bedrag dat je per trade riskeert).

| Risico per trade | 1R in € | R nodig voor €5.000 (10%) | R nodig voor €4.000 (8%) |
|---|---|---|---|
| 0,25% | €125 | 40R | 32R |
| 0,50% | €250 | 20R | 16R |
| 0,75% | €375 | 13,3R | 10,7R |
| 1,00% | €500 | 10R | 8R |

Verwachtingswaarde per trade = (winstkans × gemiddelde winst in R) −
(verlieskans × 1R). Voorbeelden met target 2R:

| Winstkans | Verwachting per trade | Trades voor 20R (0,5% risico) |
|---|---|---|
| 35% | 0,05R | 400 (niet haalbaar) |
| 40% | 0,20R | 100 |
| 45% | 0,35R | 57 |
| 50% | 0,50R | 40 |
| 55% | 0,65R | 31 |

Conclusie: met 0,5% risico en een gezonde 45 tot 50% winstkans bij 2R heb
je 40 tot 60 trades nodig, dus 2 tot 3 maanden bij 1 trade per dag. Dat is
prima: **er is geen tijdslimiet**. Wie in twee weken wil slagen, moet 1%
riskeren en zit dan bij drie verliezers op rij al op 3% en in gevaar bij
het daglimiet. Kies de trage route.

Hoeveel verliezers op rij zijn normaal bij 45% winstkans? 5 op rij komt
gemiddeld eens per ~100 trades voor, 7 op rij eens per ~600. Bij 0,5%
risico is 7 op rij 3,5% verlies: pijnlijk maar binnen de 10%. Bij 1% is
het 7% en zit je in de gevarenzone. Dat is de hele reden voor 0,5%.

## 5. Stappenplan

### Fase 0: bewijs op demo (2 tot 4 weken, gratis)
1. Open een gratis FTMO Free Trial (dezelfde regels, 14 dagen) of een
   gewone MT5-demo van €50.000.
2. Handel één strategie uit `04-strategieen.md` op één of twee markten.
3. Houd het journal bij (`07-trading-journal.md`). Ga pas door als je
   minstens 30 trades hebt met positieve verwachting **en** je geen enkele
   eigen regel hebt gebroken.
4. Installeer `PropFirmGuard.mq5` en test dat hij sluit bij je eigen limiet.

### Fase 1: Challenge (€50.000)
- Risico 0,5% per trade, maximaal 2 open posities, maximaal 1% totaal open risico.
- Eigen daglimiet: −2% (€1.000) gerealiseerd + open: dag klaar.
- Eigen weeklimiet: −4% (€2.000): week klaar, review doen.
- Na +6% winst: risico terug naar 0,25% en het doel "uitzitten". Je wilt
  nooit een bijna-geslaagde challenge nog verspelen.
- Minimum handelsdagen haal je vanzelf; open geen trade puur om een dag te tellen.

### Fase 2: Verification (5%)
- Exact hetzelfde. Het is een makkelijker doel; het gevaar is nu
  ongeduld. Zelfde risico, zelfde setups.

### Fase 3: Funded
- Eerste maand: 0,25% tot 0,5%. Vraag je eerste payout aan zodra je
  winstgevend bent (fee komt terug, en het bewijst dat het werkt).
- Laat winst niet oplopen: haal elke twee weken uit. Het account is niet
  van jou; alleen uitbetaalde winst is echt.
- Scaling Plan: bij 10% netto winst over 4 maanden met 2 payouts groeit
  het account met 25% en het winstdeel naar 90%.

### Checklist voordat je de fee betaalt
- [ ] 30+ demo-trades met positieve verwachting, gejournald
- [ ] Geen regelbreuk in de laatste 2 weken demo
- [ ] Je kent je exacte lotgrootte per instrument uit je hoofd (tabel 03)
- [ ] `PropFirmGuard` getest op demo
- [ ] Je weet waar de high-impact nieuwsmomenten deze week zijn
- [ ] Gekozen: Normal of Swing (Swing als je nieuws/weekend wilt overbruggen)
- [ ] Fee is geld dat je kunt missen
