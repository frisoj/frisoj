# Bitvavo Trader

Een visuele daytrading-bot voor [Bitvavo](https://bitvavo.com): live grafieken, vijf
strategieën die samen stemmen, strak risicobeheer, een backtest-lab met
walk-forward-validatie en een marktscanner. Alles draait lokaal op je eigen
computer en is te bedienen via een dashboard in je browser.

> ## ⚠️ Lees dit eerst
>
> **Geen enkel programma kan winst garanderen.** Ook deze bot niet. De meeste
> daytraders verliezen geld, en crypto is extreem volatiel. Zet er alleen geld in
> dat je kunt missen.
>
> Met €50 zijn de **kosten** je grootste vijand. Bitvavo rekent op het laagste
> volumeniveau 0,25% per market order (taker) en 0,15% voor limit orders (maker).
> Een complete trade (kopen + verkopen) kost dus ongeveer **0,5% plus slippage**.
> Voorbeeld: 6 trades per dag van €20 kost ±€0,60 per dag, ofwel ±1,2% van je
> €50 **per dag**. Dat is ruim €15 per maand, alleen aan kosten. Een strategie moet
> dat eerst terugverdienen voordat je iets overhoudt.
>
> Daarom werkt de bot zo:
> 1. Hij start altijd in **oefenmodus (paper trading)**: echte koersen, nep-geld.
> 2. Het **backtest-lab** laat met **walk-forward-tests** zien of een instelling ook
>    werkt op data waarop hij niet getuned is. Het oordeel is eerlijk, ook als het
>    slecht nieuws is.
> 3. **Live handelen** kan pas als je dat expliciet aanzet én in het dashboard
>    bevestigt. De bot gebruikt dan nooit meer dan je ingestelde limiet (standaard €50).
>
> Dit is geen financieel advies.

---

## Snel starten (oefenmodus)

1. Installeer **Node.js 22 of nieuwer**: <https://nodejs.org>
2. Open een terminal in deze map en installeer de onderdelen:
   ```bash
   cd bitvavo-trader
   npm install
   ```
3. Start de bot:
   ```bash
   npm start
   ```
4. Open **<http://127.0.0.1:4321>** in je browser.

De bot haalt echte koersen op bij Bitvavo en handelt met €50 nep-geld. Kan hij
Bitvavo niet bereiken (geen internet, firewall), dan schakelt hij automatisch over
op een **ingebouwde marktsimulator**. Het dashboard toont dan duidelijk
"Gesimuleerde marktdata". Handig om te oefenen, maar zeg er niets mee over echte
winstgevendheid.

Instellingen aanpassen? Kopieer `.env.example` naar `.env` en pas die aan, of
gebruik het tabblad **Instellingen** in het dashboard.

## Wat zit erin

### Dashboard

| Tabblad | Wat je ziet |
|---|---|
| **Live** | Candlestick-grafiek met EMA 9/21/200, Bollinger-banden, VWAP en volume; RSI- en MACD-panelen; koop- en verkoopsignalen en je trades als markeringen; lijnen voor instap, stop-loss en koersdoel van open posities. Daarnaast: een meter met de stemmen van alle strategieën, het marktregime, risicometers (dagverlies, blootstelling, aantal trades), je equity-curve, open posities, tradehistorie en een live logboek. Knoppen voor Start, Stop en **Noodstop**. |
| **Backtest-lab** | Test de strategie op historische data: rendement tegenover buy & hold, max drawdown, Sharpe, winrate, profit factor en betaalde fees; grafieken met trades, equity en drawdown; een histogram van trade-resultaten. **Optimaliseer** zoekt de beste parameters (met heatmap). **Walk-forward** controleert of die parameters ook werken op data waarop ze níét getraind zijn, en geeft een eerlijk oordeel. |
| **Scanner** | De 30 meest verhandelde EUR-markten met koers, 24u-verandering, volatiliteit, spread, regime, signaal, RSI en een mini-grafiek, als tabel of heatmap. |
| **Instellingen** | Markten, interval, alle risico-instellingen met uitleg, strategieën aan/uit met gewichten en drempels, en de live-modus. |

### De "hersenen": vijf strategieën die stemmen

| Strategie | Idee | Werkt het best in |
|---|---|---|
| EMA-trend | Snelle EMA kruist langzame EMA, met trendfilter (EMA 100) en ADX-sterkte | Trends |
| RSI-reversie | Koopt bij oververkocht (RSI laag + onder de onderste Bollinger-band) | Zijwaartse markt |
| Breakout | Koers breekt uit boven het Donchian-kanaal, met extra volume | Beginnende trends |
| MACD-momentum | MACD kruist zijn signaallijn, met EMA 50-filter | Trends |
| VWAP-reversie | Koers ver onder de dag-VWAP en RSI draait omhoog | Zijwaarts/volatiel |

Elke strategie geeft koop, verkoop of wacht, met een zekerheid. Het **ensemble**
weegt de stemmen tot een score tussen −1 en +1. Een **regimefilter** (trend omhoog,
trend omlaag, zijwaarts of volatiel) laat strategieën die niet bij de markt passen
minder zwaar meetellen, en blokkeert nieuwe aankopen in een dalende trend.

### Risicobeheer (standaardinstellingen voor €50)

- **Positiegrootte op basis van risico**: maximaal 1,5% van je kapitaal verliezen
  per trade als de stop-loss geraakt wordt; maximaal 45% van je kapitaal per positie.
- **Stop-loss** op 2× ATR (beweegt mee met de volatiliteit), **koersdoel** op 2× het
  risico.
- **Break-even-stop** zodra je 1R winst hebt, en daarna een **trailing stop** om
  winst vast te houden.
- **Dagelijkse verlieslimiet** van 5%: daarna geen nieuwe trades meer die dag.
- **Maximaal 6 trades per dag** en maximaal 2 posities tegelijk.
- **Afkoelperiode** na een verlies in dezelfde markt.
- **Kostenfilter**: een trade gaat alleen door als het koersdoel minstens 3× de
  totale kosten (fees + slippage) oplevert.
- **Tijdslimiet**: een positie die na 48 candles niet in de winst staat, wordt gesloten.
- Houdt rekening met de **minimale ordergrootte van €5** bij Bitvavo.

## Live handelen (echt geld). Doe dit pas na weken oefenen

1. Draai eerst een paar weken in oefenmodus, en controleer in het backtest-lab met
   **Walk-forward** op echte Bitvavo-data of je instellingen standhouden.
2. Maak bij Bitvavo een API-sleutel aan (Instellingen → API):
   - rechten: **alleen "Bekijken" en "Handelen"**, **NOOIT "Opnemen"**;
   - stel een **IP-whitelist** in met je eigen IP-adres.
3. Zet in `.env`:
   ```env
   TRADING_MODE=live
   BITVAVO_API_KEY=...
   BITVAVO_API_SECRET=...
   CAPITAL_LIMIT_EUR=50
   ```
4. Start met `npm start`. De bot rekent in live-modus alleen signalen uit en plaatst
   **geen** orders totdat je in **Instellingen → Live trading** op "Arm" klikt en
   `IK BEGRIJP HET RISICO` intypt.
5. De rode **Noodstop**-knop verkoopt alle open posities van de bot direct en zet
   hem stil.

De bot raakt alleen posities aan die hij zelf heeft geopend, en gebruikt nooit
meer dan `CAPITAL_LIMIT_EUR`.

## Backtesten vanaf de command line

```bash
npm run backtest -- --market BTC-EUR --interval 15m --days 30
npm run backtest -- --market ETH-EUR --interval 15m --days 60 --walkforward
npm run backtest -- --market SOL-EUR --interval 5m --days 14 --source simulated
```

## Hoe het in elkaar zit

```
Bitvavo REST ──▶ BitvavoFeed ─┐                        ┌─▶ PaperBroker (oefenen)
(of simulator) ─▶ SimulatedFeed┴─▶ TradingEngine ──────┤
                                   │  indicators        └─▶ LiveBroker ──▶ Bitvavo API
                                   │  5 strategieën + ensemble
                                   │  RiskManager
                                   └─▶ events ──▶ SSE ──▶ dashboard (browser)
Backtester gebruikt exact dezelfde strategieën en RiskManager.
```

| Map | Inhoud |
|---|---|
| `src/core` | Gedeelde types, standaardinstellingen, hulpfuncties |
| `src/exchange` | Bitvavo REST-client (HMAC-signing, rate limits, precisie) |
| `src/data` | Marktdata: Bitvavo-feed met cache, en de marktsimulator |
| `src/indicators` | EMA, RSI, MACD, Bollinger, ATR, ADX, Donchian, VWAP, … |
| `src/strategies` | De vijf strategieën, regime-detectie en het ensemble |
| `src/risk` | Positiegrootte, stops, limieten |
| `src/backtest` | Backtester, statistieken, optimizer, walk-forward |
| `src/broker` | Paper broker en live broker |
| `src/engine` | De trading-engine en opslag van de toestand (`data/`) |
| `src/server` | HTTP-server, API, live-updates (SSE), scanner |
| `public/` | Het dashboard (HTML/CSS/JS, grafieken via TradingView Lightweight Charts) |

Het volledige technische contract tussen de modules staat in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```bash
npm test           # unit tests
npm run typecheck  # TypeScript-controle
```

## Beperkingen: eerlijk is eerlijk

- **De bot moet blijven draaien.** Stop-losses worden door de bot bewaakt, niet
  als order op de beurs gezet. Gaat je computer in slaapstand of valt internet weg,
  dan worden stops pas uitgevoerd als de bot weer draait.
- **Alleen long**: de bot koopt en verkoopt. Short gaan (verdienen aan dalingen)
  kan niet op de spotmarkt van Bitvavo.
- **Market orders** betalen de hogere taker fee (0,25%).
- **De simulator is geen echte markt.** Goede resultaten op gesimuleerde data
  zeggen niets over echte winstgevendheid.
- **Backtests kijken terug.** Ook een goede walk-forward-test is geen garantie
  voor de toekomst.
