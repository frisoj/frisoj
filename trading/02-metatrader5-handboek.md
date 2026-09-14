# 02 · MetaTrader 5 handboek voor prop-traders

MT5 is het platform waarop FTMO, FundedNext en de meeste andere firms hun
accounts leveren. Alles hieronder is gericht op wat je nodig hebt om een
€50k account veilig en efficiënt te bedienen. Versie-info: MetaQuotes
bracht in juli 2026 MCP/AI-agent-ondersteuning uit en in september 2026
(build 6180) een AI-assistent die tester-rapporten en logs kan analyseren.

## 1. Installatie en inloggen

1. Download MT5 via de link van je prop firm (niet via een willekeurige
   broker); de firm heeft een eigen server (bijv. `FTMO-Server`,
   `FTMO-Demo`).
2. Bestand → Inloggen op handelsaccount → login, wachtwoord, server.
   Er zijn twee wachtwoorden: **master** (handelen) en **investor**
   (alleen kijken). Gebruik investor als je iemand mee wilt laten kijken.
3. Zet de **servertijd** in je hoofd: FTMO draait op CE(S)T, dus gelijk
   aan Nederlandse tijd. Bij andere brokers is servertijd vaak GMT+2/+3.
   De "dag" voor het daglimiet begint op middernacht servertijd.
4. Instellingen: Extra → Opties → **Handel**: standaard lotgrootte,
   afwijking (slippage) toestaan; **Grafieken**: "Toon handelsgeschiedenis"
   aan; **Meldingen**: MetaQuotes-ID koppelen aan de mobiele app voor
   push-alerts.

## 2. Interface: de vijf vensters die je gebruikt

| Venster | Sneltoets | Gebruik |
|---|---|---|
| Market Watch | Ctrl+M | Symbolen, spread, klik-rechts → Specificatie (contractgrootte, tick, swap, handelsuren) |
| Navigator | Ctrl+N | Accounts, indicatoren, EA's, scripts |
| Toolbox | Ctrl+T | Trade (open posities, equity), History, Kalender, Journal, Experts (EA-logs) |
| Grafiek | F8 (eigenschappen) | Bied/laat-lijn aan, grid uit, handelsniveaus tonen |
| Strategy Tester | Ctrl+R | Backtesten en optimaliseren |

Sneltoetsen die tijd besparen: **F9** nieuw order, **Alt+1/2/3** staaf-,
candle-, lijngrafiek, **Ctrl+I** indicatorenlijst, **F12** één candle
vooruit (bar-replay voor oefenen), **Shift+F12** één terug, **Ctrl+F**
crosshair, **+/−** zoom, **spatie** snel naar tijd, **Ctrl+B** objectenlijst.

**Profielen en templates**: Grafiek → Template → opslaan legt je indicatoren
en kleuren vast; Bestand → Profielen bewaart een hele set grafieken. Maak
één profiel "Challenge" met precies de 2 tot 4 markten die je handelt.

## 3. Ordertypen en uitvoering

| Type | Wat het doet | Wanneer |
|---|---|---|
| Market (Buy/Sell) | direct tegen huidige prijs | momentum-entries; accepteer slippage |
| Buy Limit / Sell Limit | koop onder / verkoop boven de markt | pullback naar niveau; betere prijs, geen garantie op vulling |
| Buy Stop / Sell Stop | koop boven / verkoop onder de markt | breakouts |
| Buy Stop Limit / Sell Stop Limit | stop die een limit activeert | breakout zonder slechte vulling (uniek in MT5) |

**Vulbeleid (Fill Policy)** in het orderticket:
- *Fill or Kill*: alles of niets.
- *Immediate or Cancel*: deelvulling toegestaan, rest vervalt.
- *Return*: rest blijft als order staan.
Voor CFD-accounts bij prop firms is meestal alleen FOK of IOC beschikbaar; laat
het op standaard staan.

**Expiratie**: GTC (tot annulering), Vandaag, Gespecificeerd. Zet pending
orders voor een sessie-breakout op "Vandaag" zodat er niets blijft hangen.

**Netting vs Hedging**: prop-firm-accounts zijn vrijwel altijd *hedging*
(meerdere posities per symbool, ook long en short tegelijk). Bij *netting*
wordt alles op één symbool samengevoegd. Zie de accountnaam in Navigator.

**Stop Loss en Take Profit** zitten aan de positie vast en worden
server-side uitgevoerd: ze werken ook als je computer uit staat.
**Trailing stop daarentegen is client-side**: hij werkt alleen zolang je
terminal open is en verbonden. Gebruik dus een echte SL en laat de trailing
alleen aanvullend werken, of draai op een VPS.

**One-click trading** (paneel linksboven in de grafiek) is snel maar
gevaarlijk: één misklik is een positie zonder stop. Bij een challenge:
uitzetten en via F9 werken met SL vooraf ingevuld.

**Positie (deels) sluiten**: Toolbox → Trade → rechtermuisknop → Sluiten,
of dubbelklik op de positie en kies een kleiner volume. Kies "Close by"
om een long en short op hetzelfde symbool tegen elkaar weg te strepen.

## 4. Marginberekening en hefboom

```
margin = (lots × contractgrootte × prijs) / hefboom
```
Voorbeeld: 1 lot EUR/USD bij 1,16 en 1:100 = 100.000 × 1,16 / 100 ≈ €1.000
(in een euro-account rekent de server om). Bij 1:30 (Swing) is dat ≈ €3.333.
Met 0,5%-risico en 20-pip stops zit je op 1 tot 2 lot: op een €50k account
gebruik je dan slechts 2 tot 7% van je vrije margin. Hefboom is nooit je
beperking; risico wel.

**Margin call / stop-out**: FTMO stop-out bij 50% margin level. Met de
bovenstaande groottes kom je daar nooit; het daglimiet grijpt veel eerder in.

## 5. Indicatoren die de moeite waard zijn (en instellingen)

- **EMA 20 / 50 / 200** (Moving Average, methode Exponential): trend en
  pullback-zones. Prijs boven stijgende EMA 50 met EMA 20 erboven = long-bias.
- **ATR 14**: meet volatiliteit; gebruik voor stops (1,5 × ATR) en voor
  het bepalen of een markt genoeg beweegt (goud H1-ATR onder $8 = saai).
- **RSI 14**: alleen voor divergentie bij range-setups; niet als
  "overbought = verkopen".
- **ADX 14**: onder 20 = range (fade niveaus), boven 25 = trend (volg).
- **Volumes** (tick volume): pieken bij sessie-opens bevestigen breakouts.
- **Sessies**: MT5 heeft geen ingebouwde sessie-indicator; gebruik de
  gratis "Sessions" van de Code Base (Navigator → Indicatoren → rechtermuis
  → "Download from Code Base" of via mql5.com/en/code).
- Wat je niet nodig hebt: tien oscillatoren over elkaar. Twee tot drie
  gereedschappen, consistent gebruikt.

Indicatoren toevoegen: Invoegen → Indicatoren, of sleep uit Navigator.
Parameters wijzigen: rechtermuisknop op grafiek → Indicatorenlijst (Ctrl+I).

## 6. Grafiekobjecten en alerts

- Horizontale lijnen voor je niveaus: Invoegen → Objecten → Lijnen. Geef
  ze een beschrijving (dubbelklik → Beschrijving) zodat je ze in de
  objectenlijst (Ctrl+B) terugvindt.
- **Alerts**: Toolbox → tab Meldingen → rechtermuis → Maken. Kies Bid/Ask
  boven/onder niveau, geluid + push naar mobiel. Dit is de manier om niet
  de hele dag naar het scherm te staren: zet alerts op je niveaus en doe
  iets anders tot ze afgaan.
- Fibonacci-retracement voor pullback-zones (38,2 tot 61,8%).

## 7. Economische kalender in MT5

Toolbox → **Kalender** toont nieuws met impact-sterren, verwachting en
vorige waarde, in servertijd. Rechtermuisknop op een event → "Toon op
grafiek" zet verticale lijnen op je chart. Voor een funded FTMO Normal
account: filter op hoge impact en zet alerts 5 minuten voor elk event op
de instrumenten die je open hebt.

## 8. Strategy Tester: je edge bewijzen vóór je fee betaalt

Open met Ctrl+R. Belangrijkste keuzes:

| Instelling | Aanbeveling |
|---|---|
| Modellering | "Elke tick op basis van echte ticks" voor eindtest; "1 minuut OHLC" om snel te verkennen |
| Periode | minstens 2 jaar, inclusief 2026 (hoge volatiliteit) |
| Vertraging | "Willekeurige vertraging" of 50 tot 100 ms, nooit 0 |
| Deposito | 50.000 EUR, hefboom zoals je account |
| Forward | 1/3 of 1/4: optimaliseer op het eerste deel, valideer op het laatste |
| Visualisatie | aan om je setup-logica op de grafiek te zien |

Optimalisatie: "Snelle genetische algoritme" voor veel parameters, "Volledig"
voor weinig. Optimaliseer nooit meer dan 2 tot 3 parameters: daarna pas je
de strategie aan het verleden aan (overfitting). Beoordeel het rapport op:
**Profit factor > 1,4**, **maximale drawdown < 8%** (anders haal je de
FTMO-limiet niet), **Sharpe > 1**, **minstens 100 trades**, en een
gelijkmatige equity-curve. Wantrouw alles met een profit factor boven 3.

Een discretionaire strategie test je met **bar-replay**: zet de grafiek op
een datum in het verleden (rechtermuis → Grafiek verschuiven, of scroll met
autoscroll uit), verberg de rechterkant en stap met F12 per candle vooruit.
Noteer elke trade in het journal alsof hij echt is.

De AI-assistent (build 6180, september 2026) kan tester-rapporten en
logs uitlezen; handig om optimalisatieruns te vergelijken. Het blijft een
hulpmiddel, geen strategie.

## 9. MQL5: wat je minimaal moet weten

- **Script**: draait één keer (bijv. lotgrootte berekenen, alle posities
  sluiten). Bestand: `MQL5/Scripts/`.
- **Indicator**: tekent op de grafiek. `MQL5/Indicators/`.
- **Expert Advisor (EA)**: draait continu op een grafiek, mag handelen.
  `MQL5/Experts/`. Handelen alleen als de knop **Algo Trading** (werkbalk)
  aan staat én "Automatisch handelen toestaan" in de EA-eigenschappen.
- **MetaEditor** (F4) compileert `.mq5` naar `.ex5`. Fouten staan onderaan
  in het "Fouten"-tabblad.
- Datamap: Bestand → Open datamap. Daar staan `MQL5/`, logs en profielen.
- Standaardbibliotheek: `#include <Trade\Trade.mqh>` geeft `CTrade` met
  `Buy()`, `Sell()`, `PositionClose()` enz.
- Belangrijke functies: `AccountInfoDouble(ACCOUNT_EQUITY)`,
  `SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE)`,
  `PositionsTotal()`, `PositionGetTicket(i)`, `OrderSend()`.

De twee tools in `mql5/` zijn geschreven zodat je ze direct kunt compileren:
kopieer `PropRiskCalculator.mq5` naar `MQL5/Scripts/` en
`PropFirmGuard.mq5` naar `MQL5/Experts/`, open ze in MetaEditor, druk F7.

**Prop-firm-regels voor EA's**: bij FTMO zijn EA's toegestaan, maar niet
het kopiëren van andermans signalen op grote schaal, arbitrage,
tick-scalping of het spiegelen van accounts. Een risk-guard-EA die alleen
sluit is altijd toegestaan.

## 10. Rapportage en journal-export

Toolbox → History → rechtermuisknop → **Rapport** (HTML of Excel) geeft
alle trades met open/close-tijd, prijzen, swaps, commissies en winst. Doe
dit elke vrijdag en plak de kerngetallen in `07-trading-journal.md`.
Rechtermuisknop → "Alle geschiedenis" om verder terug te kijken.

## 11. Mobiel, VPS en continuïteit

- **MT5 mobiel** (iOS/Android): posities beheren, SL/TP verplaatsen,
  push-alerts. Openen van nieuwe trades vanaf je telefoon in een challenge
  afraden: geen risicoberekening, wel emotie.
- **VPS** (Navigator → rechtermuis op account → Registreer VPS, of een
  externe Windows VPS): alleen nodig als je een EA 24/5 draait of trailing
  stops gebruikt. Voor discretionair handelen met server-side SL/TP niet nodig.
- **Verbinding verloren** rechtsonder: SL/TP blijven werken (server),
  pending orders ook; trailing stop en EA's niet.

## 12. Veelgemaakte MT5-fouten in challenges

1. Order geplaatst zonder SL omdat het ticket "SL: 0" liet staan.
2. Lotgrootte verwisseld (1,0 in plaats van 0,10) door de standaardwaarde
   in Opties → Handel. Zet die standaard op je kleinste normale grootte.
3. Trailing stop gebruikt en de laptop dichtgeklapt.
4. Verkeerd symbool: `GER40.cash` vs `GER40` (future met andere
   contractgrootte en expiratie).
5. Stop binnen de spread-verbreding rond 23:00 servertijd.
6. Pending order vergeten: dagen later gevuld tijdens nieuws.
7. Handelen op de demo-server gedacht maar op de challenge ingelogd, of andersom.
   Zet de accountnaam in de titelbalk (standaard) en kijk ernaar.
