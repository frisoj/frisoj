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

> ## ✅ Status: gecontroleerd, maar nog nooit tegen de echte Bitvavo getest
>
> De code is in vijf rondes door meerdere onafhankelijke reviewers doorgelicht; alle
> gevonden kritieke problemen zijn opgelost en opnieuw gecontroleerd (1400+ tests, zie
> [`docs/REVIEW-STATUS.md`](docs/REVIEW-STATUS.md)).
>
> **Maar:** de koppeling met Bitvavo is gebouwd volgens Bitvavo's API-documentatie en
> getest tegen een nagebootste Bitvavo, niet tegen de echte servers (die waren vanuit de
> ontwikkelomgeving niet bereikbaar). Doe de eerste keer daarom deze drie stappen:
>
> 1. **Oefenmodus met echte koersen**: `TRADING_MODE=paper` en `DATA_SOURCE=bitvavo`.
>    Laat hem een paar dagen draaien; het dashboard moet echte koersen tonen.
> 2. **Live, maar niet gearmd**: zet je API-sleutel in `.env`, `TRADING_MODE=live`,
>    `CAPITAL_LIMIT_EUR=50`, en start zónder te armen. De bot leest dan je saldo en fees
>    en toont "zou kopen …", maar plaatst niets. Zie je fouten over de sleutel of
>    "handtekening", stop dan en arm niet.
> 3. **Pas dan armen**, en houd de eerste trades zelf in de gaten in de Bitvavo-app.

---

## Snel starten (oefenmodus)

**Windows, zonder typen:** installeer Node.js (stap 1 hieronder) en dubbelklik daarna
in de map `bitvavo-trader` op **`start-bot.bat`**. Dat bestand installeert de
onderdelen, start de bot en opent het dashboard vanzelf in je browser. Laat het
zwarte venster open: sluit je het, dan stopt de bot.

Met de hand:

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

> **Dashboard gaat vóór `.env`.** Zodra je in het dashboard instellingen opslaat,
> bewaart de bot ze in `data/config.json` (in je `DATA_DIR`). Vanaf dan gelden de
> markten en het interval uit het dashboard, en worden `MARKETS` en `INTERVAL` in
> `.env` genegeerd. De bot meldt dat bij het starten. Wil je `.env` weer laten
> gelden, pas het dan aan in het dashboard, of verwijder `data/config.json`
> (let op: dan vervallen ook je andere opgeslagen instellingen, zoals risico en
> strategieën).

### Bijwerken naar een nieuwe versie

1. Stop de bot (sluit het zwarte venster, of druk daarin op Ctrl+C).
2. Download de nieuwe zip en pak hem uit **over de oude map heen**. Kies
   "Bestanden vervangen" als Windows dat vraagt. Je `.env` (instellingen) en de map
   `data` (je trades en opgeslagen instellingen) zitten niet in de zip, dus die
   blijven gewoon staan.
3. Start opnieuw met `start-bot.bat` (dat doet ook `npm install`), of met
   `npm install` en daarna `npm start`.

### Op je telefoon bekijken

De bot draait op je computer; je telefoon is het scherm en de afstandsbediening.
Computer en telefoon moeten op **dezelfde wifi** zitten, en de computer moet aan
blijven staan.

1. Zet in `.env`:
   ```env
   HOST=0.0.0.0
   DASHBOARD_TOKEN=verzin-een-code-van-minstens-8-tekens
   ```
2. Start met `npm start`. In het startscherm staat nu een regel als
   `➜ Op je telefoon (zelfde wifi): http://192.168.1.23:4321`.
3. Open dat adres in de browser op je telefoon en vul je code in als daarom
   gevraagd wordt. Tip: zet de pagina op je beginscherm ("Zet op beginscherm").

Zet het dashboard **niet** open op internet (geen port forwarding in je router):
buiten je eigen wifi is het niet bedoeld om te bedienen.

## Wat zit erin

### Dashboard

| Tabblad | Wat je ziet |
|---|---|
| **Live** | Candlestick-grafiek met EMA 9/21/200, Bollinger-banden, VWAP en volume; RSI- en MACD-panelen; koop- en verkoopsignalen en je trades als markeringen; lijnen voor instap, stop-loss en koersdoel van open posities. Daarnaast: je equity, P&L vandaag en totale P&L, een meter met de stemmen van alle strategieën, het marktregime, risicometers (dagverlies, blootstelling, aantal trades), je equity-curve met de grootste daling ("Max. daling"), open posities (met de knoppen **Sluit** en, als een positie onverkoopbaar is, **Afschrijven**), tradehistorie, een live logboek en de **munten-radar** met alle munten die de bot volgt. Knoppen voor Start, Stop en **Noodstop**. |
| **Backtest-lab** | Test de strategie op historische data: rendement tegenover buy & hold, max drawdown, Sharpe, winrate, profit factor en betaalde fees; grafieken met trades, equity en drawdown; een histogram van trade-resultaten. **Optimaliseer** zoekt de beste parameters (met heatmap). **Walk-forward** controleert of die parameters ook werken op data waarop ze níét getraind zijn, en geeft een eerlijk oordeel. |
| **Scanner** | De 30 meest verhandelde EUR-markten met koers, 24u-verandering, volatiliteit, spread, regime, signaal, RSI en een mini-grafiek, als tabel of heatmap. |
| **Instellingen** | Munten (automatisch of zelf kiezen, tot 400), interval, het trendfilter, alle risico-instellingen met uitleg (ook de spreadlimiet), strategieën aan/uit met gewichten en drempels, en de live-modus. |

**Ook als de bot stilstaat, blijven de koersen ververst.** Vóór je op Start
drukt, na Stop en na de Noodstop haalt de bot elke ronde (standaard elke 15
seconden) alleen de actuele koersen op. Zo kloppen de waarde van je posities en
je P&L, ook direct na een herstart. Hij neemt dan geen beslissingen en plaatst
geen orders: stop-loss en koersdoel worden **niet** bewaakt zolang de bot stilstaat.

Backtests, optimalisaties en walk-forward-tests zijn zwaar rekenwerk. Ze draaien
daarom in een **aparte rekenthread**: de bot blijft ondertussen gewoon werken
(stop-losses bewaken, de Noodstop, live-updates in het dashboard). Er loopt één
berekening tegelijk; duurt hij langer dan 2 minuten, dan wordt hij afgebroken en
krijg je het advies om minder dagen of minder combinaties te kiezen.

De backtest rekent zo eerlijk mogelijk: een signaal wordt pas bij de opening van
de volgende candle uitgevoerd, met fees en slippage (minstens de helft van de
echte bied/laat-spread van de markt). Ook in de backtest weigert de "beurs"
verkopen onder €5; je krijgt dan een waarschuwing hoeveel trades daardoor
vastzaten. Heeft een markt te weinig historie, dan wordt de periode ingekort en
staat dat erbij.

### De "hersenen": vijf strategieën die stemmen

| Strategie | Idee | Werkt het best in |
|---|---|---|
| EMA-trend | Snelle EMA kruist langzame EMA, met trendfilter (EMA 100) en ADX-sterkte | Trends |
| RSI-reversie | Koopt bij oververkocht (RSI laag + onder de onderste Bollinger-band) | Zijwaartse markt |
| Breakout | Koers breekt uit boven het Donchian-kanaal, met extra volume | Beginnende trends |
| MACD-momentum | MACD kruist zijn signaallijn, met EMA 50-filter | Trends |
| VWAP-reversie | Koers ver onder de dag-VWAP en RSI draait omhoog | Zijwaarts/volatiel |

Elke strategie geeft koop, verkoop of wacht, met een zekerheid. Het **ensemble**
weegt de stemmen tot een score tussen −1 en +1. Voor een **koop** is brede steun
nodig: de score telt alle strategieën mee. Voor een **verkoop** tellen alleen de
strategieën die iets vinden, zodat één duidelijk verkoopsignaal niet wordt
"weggestemd" door strategieën die afwachten. Een **regimefilter** (trend omhoog,
trend omlaag, zijwaarts of volatiel) laat strategieën die niet bij de markt passen
minder zwaar meetellen, en blokkeert nieuwe aankopen in een dalende trend.

### Veel munten (tot 400) en slimmer kopen

- **Automatisch munten kiezen** (standaard): elk uur kiest de bot de 30 munten met
  de meeste handel op Bitvavo. Stablecoins (zoals USDC), goud-tokens en munten met
  weinig handel of een grote spread laat hij weg. In **Instellingen → Munten** kies
  je hoeveel (1 tot 400), of je schakelt naar **Zelf kiezen** en zet er tot 400
  munten in. In `.env` kan het ook: `MARKETS=auto:100`, of een lijst zoals
  `MARKETS=BTC-EUR,ETH-EUR`.
- **Meer munten betekent meer keus, niet meer posities.** Met €50 houdt de bot er
  maar een paar tegelijk vast (standaard 2). Geven meerdere munten tegelijk een
  koopsignaal, dan koopt hij eerst **de sterkste kans**: het hoogste signaal, en bij
  gelijke stand de munt die het beter doet dan Bitcoin.
- **Trendfilter (Bitcoin):** de bot koopt alleen als Bitcoin boven zijn gemiddelde van
  de laatste 50 dagen staat. Zakt de hele markt weg, dan wacht hij. Dat kan betekenen
  dat hij weken niets koopt; verkopen, stop-losses en koersdoelen gaan altijd gewoon
  door. In ons onderzoek op echte dagkoersen (2016–2026) was dit het enige idee dat
  ook buiten de testperiode standhield, vooral doordat het grote dalingen ontweek.
  Optioneel kan hetzelfde filter ook per munt (Muntfilter).
- **Spreadlimiet:** bij kleine munten ligt de koop- en verkoopprijs soms ver uit
  elkaar. Is dat verschil (de spread) groter dan 0,3%, dan koopt de bot die munt niet.
- **Munten-radar** (tabblad Live): één tegel per munt met koers, 24-uursverandering,
  signaalsterkte en status: in positie, koopsignaal (met plek in de ranglijst) of
  tegengehouden, met de reden erbij. Bovenaan zie je of het trendfilter kopen toestaat
  en hoeveel munten al bekeken zijn.
- Ook met 400 munten blijft de bot binnen Bitvavo's limieten: hij haalt alle koersen
  in één keer op, en de grafieken per munt verspreid over een paar rondes, één keer
  per candle. Open posities komen elke ronde als eerste aan de beurt, zodat stop-losses
  snel blijven. Met heel veel munten op een kort interval (bijv. 400 op 1-minuutcandles)
  lukt niet alles elke candle; de radar waarschuwt dan.
- **Had je al een eigen muntenlijst opgeslagen** in een eerdere versie, dan blijft die
  staan. Automatisch kiezen zet je aan in **Instellingen → Munten**.

### Bot-wedstrijd: vier bots, elk met €25

Standaard draaien er **vier bots tegelijk**, elk met **€25 oefengeld** (samen €100) en
een eigen manier van handelen. Zo zie je met echte koersen welke aanpak het best werkt.

| Bot | Hoe hij handelt | Candles |
|---|---|---|
| **Snelle scalper** | Korte uitbraken en momentum in de 60 meest verhandelde munten; kleine winsten, krappe stop, ook in een dalende markt. Koopt alleen als de verwachte winst minstens 3× de kosten is. | 5 min |
| **Trendvolger** | Alleen als Bitcoin én de munt in een stijgende trend zitten; laat winnaars lang lopen (koersdoel 3× het risico). | 1 uur |
| **Dip-koper** | Koopt kort oververkochte munten en verkoopt bij het herstel; niet als Bitcoin daalt. | 15 min |
| **Allrounder** | Alle vijf strategieën samen, met een krappere stop-loss (1,5× ATR) en max. 20 trades per dag. | 15 min |

- Het tabblad **Wedstrijd** zet ze naast elkaar: ranglijst, één grafiek met vier lijnen,
  resultaat vóór en na kosten, en een uitleg in gewone taal. Knoppen: alles starten,
  alles stoppen en een noodstop voor alle bots.
- Elke bot heeft een **eigen dashboard** (bovenin wisselen, of `/bot/scalper/`,
  `/bot/trend/`, `/bot/dip/`, `/bot/allround/`) met eigen instellingen, posities en trades.
  Wat je daar opslaat, geldt alleen voor die bot.
- In `.env`: `BOTS=trend,dip` (alleen die bots), `BOTS=allround` (één bot, zoals vroeger),
  `PAPER_CAPITAL_PER_BOT=25` (oefengeld per bot).
- **Echt geld:** er mag maar **één** bot live handelen, de rest blijft oefenen op echte
  koersen. Kies die met `LIVE_BOT=trend` (zie "Live handelen"). Wissel je later van live-bot
  terwijl de vorige nog echte posities open had, dan weigert de nieuwe te starten tot je
  die eerst hebt afgehandeld (anders zouden die munten zonder stop-loss blijven staan).
- **Eerlijk:** in een test van 3 maanden met de simulator verloren alle vier (Trendvolger
  −2,8%, Scalper −3,9%, Dip-koper −5,2%, Allrounder −8,6%); alleen de Trendvolger verdiende
  vóór kosten iets. Zonder kostenfilter verloor de Scalper 40%. De wedstrijd met échte
  koersen laat zien hoe het echt zit.

### Risicobeheer (standaardinstellingen voor €50)

- **Positiegrootte op basis van risico**: je verliest maximaal 1,5% van je kapitaal
  per trade (inclusief kosten) als de stop-loss geraakt wordt. Bij €50 is dat
  ongeveer €0,75. Daarnaast maximaal 45% van je kapitaal per positie.
- **Altijd verkoopbaar bij de stop-loss.** Bitvavo weigert elke order onder het
  minimum van de markt (meestal €5), ook een verkooporder. De bot gebruikt het
  minimum dat Bitvavo per markt opgeeft; weet hij dat niet, dan rekent hij met €5.
  Een positie van precies €5 kun je dus niet meer verkopen zodra de koers een
  beetje daalt. Daarom koopt de bot alleen als de positie zo groot is dat hij
  **bij de stop-loss nog boven het minimum** verkocht kan worden (met 3% extra
  marge voor koersgaten en afronding). De instelling "Minimale ordergrootte" kan
  die ondergrens voor het kopen alleen verhogen, nooit verlagen.
- **Nooit meer risico om het minimum te halen.** Is de positie volgens je risico
  te klein, dan maakt de bot hem alleen groter als het verlies bij de stop-loss
  daardoor níét boven je "Risico per trade" komt. Lukt dat niet, dan slaat hij de
  trade over en staat in het logboek waarom.
- **Stop-loss** op 2× ATR (beweegt mee met de volatiliteit), **koersdoel** op 2× het
  risico.
- **Break-even-stop**: na 1R winst gaat de stop naar je instapprijs plus kosten.
  Daarna een **trailing stop** die op 2,5× ATR onder de hoogste koers meeschuift.
  De stop gaat alleen omhoog als een candle is afgesloten (niet halverwege), en
  naar break-even alleen als de slotkoers daar al boven ligt. Zo word je niet
  meteen met verlies uitgestopt.
- **Dagelijkse verlieslimiet** van 5%: daarna geen nieuwe trades meer tot de
  volgende dag, ook als je posities die dag weer herstellen. Open posities worden
  wel bewaakt. Winst die de bot buiten zijn budget zet ("afgeroomd") en een
  gewijzigde kapitaallimiet tellen niet als verlies; een afgeschreven positie wel
  (zie hieronder).
- **Dagdoel als winstgrens** (+1%): staat je vandaag 1% in de plus (ná verkoopkosten,
  inclusief open posities), dan handelt de bot gewoon door. Zakt je dagwinst daarna
  terug tot +1%, dan verkoopt hij alles om de winst vast te zetten en doet hij tot de
  volgende dag niets meer ("Winst vastgezet ✓"). Een nieuwe trade die de dagwinst
  door zijn eigen kosten al tot de grens zou duwen, slaat hij over. Instellen of
  uitzetten (0) bij **Instellingen → Risicobeheer → Dagdoel**.
  **Eerlijk:** de grens beschermt een goede dag, maar maakt de bot niet vaker winstgevend.
  In een gesimuleerd jaar (10 munten, 15-minutencandles) haalde de bot op ongeveer 3
  op de 100 dagen +1%, en verloor hij op meer dagen dan hij won. Op 5-minutencandles
  was het slechter. Het Backtest-lab toont per test hoeveel dagen +1% haalden
  ("Resultaat per dag").
- **Maximaal 6 trades per dag** en maximaal 2 posities tegelijk. Meer trades kost meer
  fees: in de tests verloor de bot mét meer trades juist meer.
- **Afkoelperiode**: na een verlies koopt de bot 4 candles lang niet in dezelfde markt.
- **Kostenfilter**: een trade gaat alleen door als het koersdoel minstens 3× de
  totale kosten (fees + slippage) oplevert.
- **Tijdslimiet**: een positie die na 48 candles niet in de winst staat (na kosten),
  wordt gesloten.

### Open posities: "Onverkoopbaar" en "Afschrijven"

Soms is een positie toch minder dan het minimum (€5) waard, bijvoorbeeld na een
flinke koersdaling. Bitvavo weigert dan elke verkoop: van de stop-loss, van de
knop **Sluit** en van de **Noodstop**. De bot doet dan het volgende:

- Hij stuurt geen zinloze order, maar zet bij de positie het label
  **Onverkoopbaar**, met de reden (bijv. "waarde €4,60 < minimum €5,00").
- Wil hij de positie verkopen (stop-loss, verkoopsignaal of jouw klik op Sluit),
  dan onthoudt hij dat en verkoopt hij **zodra de waarde weer €5 of meer is**.
  Dat doet hij alleen als de bot draait (en in live-modus: als live trading aan
  staat); anders zegt het label wat je zelf kunt doen. Stop-loss en koersdoel
  worden voor die positie niet meer opnieuw bekeken: de verkoop staat al klaar.
- Heeft Bitvavo zelf een verkoop geweigerd omdat hij onder het minimum lag, dan
  probeert de bot het niet elke ronde opnieuw. Hij wacht tot de positie minstens
  1% meer waard is dan het minimum én dan de waarde waarbij Bitvavo weigerde, en
  probeert het dan hooguit één keer per 5 minuten. Zo geeft een koers die rond
  €5 schommelt geen stroom aan orders en meldingen. **Sluit** en de **Noodstop**
  proberen het wel meteen.
- Tot die tijd telt de positie gewoon mee (als een van je 2 posities).

Wil je niet wachten, dan kun je de positie **afschrijven** (knop **Afschrijven**
naast Sluit). Dat betekent:

- de bot beheert de positie niet meer: geen stop-loss, geen koersdoel, geen
  verkooppogingen;
- je volledige inleg wordt als **verlies** geboekt (−100%). In je trades staat
  hij als "Afgeschreven";
- dat verlies telt als **verlies van vandaag**: het kan de dagelijkse
  verlieslimiet laten afgaan (dan vandaag geen nieuwe trades meer), en de bot
  koopt die markt een paar candles niet (afkoelperiode na verlies);
- de munten **blijven gewoon op je Bitvavo-account staan** (in de oefenmodus: op
  je oefenaccount). Je kunt ze later zelf op Bitvavo verkopen, bijvoorbeeld door
  bij te kopen tot boven €5 en dan alles te verkopen.

Vlak voordat de bot afschrijft, haalt hij de **actuele koers** op (en in
live-modus ook je saldo op Bitvavo). Is de positie intussen weer te verkopen, dan
schrijft hij **niets** af en krijg je dat te zien: gebruik dan **Sluit**. Lukt het
ophalen niet, probeer het dan zo opnieuw. Afschrijven kan ook even niet zolang
de Noodstop bezig is, de positie op dat moment gesloten wordt, er nog een order
loopt, of er voor die positie een verkooporder met onbekende uitkomst openstaat.

Afschrijven kan alleen bij een onverkoopbare positie en is niet terug te draaien.

### Je resultaat: winst, verlies en afromen

Bovenaan het dashboard zie je **Equity** (je euro's plus de huidige waarde van
je open posities), **P&L vandaag** en **Totale P&L**. De bot rekent die zelf uit:

- **Totale P&L** = wat de bot nu heeft + wat hij buiten zijn budget heeft gezet
  − het kapitaal dat je hem gaf. Het percentage is ten opzichte van dat kapitaal:
  je startbedrag (oefenmodus: `PAPER_STARTING_CAPITAL`, live: `CAPITAL_LIMIT_EUR`),
  plus eventuele latere verhogingen van de limiet.
- **P&L vandaag** telt hetzelfde vanaf middernacht (Nederlandse tijd), als
  percentage van het kapitaal waarmee de bot vandaag handelt. De **dagelijkse
  verlieslimiet** kijkt naar precies dit percentage.
- **Max. daling** (bij de equity-curve) is de grootste daling van je resultaat
  van een piek naar een dal, in euro's en als percentage van het kapitaal dat je
  de bot gaf.

Alleen in live-modus:

- **Afgeroomd.** De bot handelt nooit met meer dan `CAPITAL_LIMIT_EUR` (geld in
  open posities telt mee). Komt hij door winst boven die limiet, dan laat hij het
  deel erboven op je Bitvavo-account staan, buiten zijn handelsbudget. Dat is
  gewoon jouw winst: het telt mee in je Totale P&L, is nooit een verlies en laat
  dus ook nooit de dagelijkse verlieslimiet afgaan.
- **Limiet veranderd.** Je kunt `CAPITAL_LIMIT_EUR` aanpassen tussen twee keer
  starten. Een **hogere** limiet is een storting (meer budget, geen winst), een
  **lagere** limiet een opname (het verschil gaat terug buiten het budget, geen
  verlies). Heeft de bot al verlies gemaakt, dan gaat er minder terug. Zit er op
  dat moment meer dan de nieuwe limiet in open posities, dan gaat dat deel terug
  zodra die verkocht zijn. Eerst verlagen en daarna weer verhogen telt niet
  dubbel: het teruggezette geld geldt niet als nieuw kapitaal.
- De **equity-curve** telt afgeroomde winst en opnames mee (en stortingen niet),
  zodat afromen of een andere limiet geen nep-daling of nep-stijging geeft.

## Live handelen (echt geld). Doe dit pas na weken oefenen

1. Draai eerst een paar weken in oefenmodus, en controleer in het backtest-lab met
   **Walk-forward** op echte Bitvavo-data of je instellingen standhouden.
2. Maak bij Bitvavo een API-sleutel aan (Instellingen → API):
   - rechten: **alleen "Bekijken" en "Handelen"**, **NOOIT "Opnemen"**;
   - stel een **IP-whitelist** in met je eigen IP-adres.
3. Zet in `.env` (met meerdere bots ook `LIVE_BOT=`: de ene bot die echt handelt):
   ```env
   TRADING_MODE=live
   LIVE_BOT=trend
   BITVAVO_API_KEY=...
   BITVAVO_API_SECRET=...
   CAPITAL_LIMIT_EUR=50
   DASHBOARD_TOKEN=een-lang-geheim-wachtwoord
   ```
   Het dashboard weigert al verzoeken van andere websites, maar met een
   `DASHBOARD_TOKEN` (minstens 8 tekens) kan ook geen ander programma op je
   computer de bot bedienen. Het dashboard vraagt er één keer om en onthoudt het
   in je browser.
4. Start met `npm start` en klik in het dashboard op **Start**. In live-modus
   start de bot nooit vanzelf. Hij rekent eerst alleen signalen uit en plaatst
   **geen** orders ("zou kopen …" in het logboek), totdat je in
   **Instellingen → Live trading** op **Arm live trading** klikt (of bovenaan op
   **Live handel inschakelen**) en `IK BEGRIJP HET RISICO` intypt.
5. **Let op:** zolang live trading niet aan staat, voert de bot ook **geen
   stop-losses** uit op je echte posities (hij logt dan alleen "zou verkopen").
   Dat geldt ook na elke herstart: live trading staat dan weer uit. Zet het weer
   aan, of sluit je posities zelf. De knoppen **Sluit** en **Noodstop** verkopen
   wél, ook als live trading uit staat.

De bot raakt alleen posities aan die hij zelf heeft geopend, en gebruikt nooit
meer dan `CAPITAL_LIMIT_EUR` (geld in open posities telt mee). Winst boven die
limiet laat hij op je account staan, buiten zijn handelsbudget. Het dashboard
toont dat als "afgeroomd" (zie
[Je resultaat: winst, verlies en afromen](#je-resultaat-winst-verlies-en-afromen)).

### De Noodstop

De rode **Noodstop**-knop:

1. zet de bot direct stil (ook een ronde die op dat moment loopt koopt niets
   meer) en zet live trading uit;
2. zoekt eerst uit hoe het zit met orders waarvan de uitkomst nog onbekend is;
3. probeert daarna **elke** open positie van de bot direct tegen marktprijs te
   verkopen;
4. vertelt je precies wat er gelukt is: "alles verkocht", of welke posities
   **niet** verkocht konden worden en waarom. Bijvoorbeeld: onder het minimum van
   €5, geweigerd door Bitvavo, uitkomst van de verkoop onbekend, munten die
   vastzitten in een openstaande order, of een positie die intussen is
   afgeschreven (dan is er niets verkocht). Ook kooporders met een onbekende
   uitkomst staan in dat lijstje: als zo'n order toch is uitgevoerd, staan die
   munten nog op je account.

Zolang de noodstop bezig is, kun je de bot niet starten, live trading niet
aanzetten en niets afschrijven. De noodstop eindigt **altijd** met een
stilstaande bot en live trading uit, ook als er onderweg iets misgaat. Wil je
daarna verder, start de bot dan zelf opnieuw (en zet live trading weer aan).

De bot stopt ook als een verkoop mislukt. Wat niet verkocht is, blijft open
**zonder stop-loss** (de koersen worden nog wel ververst). Controleer je account
en verkoop het zelf op Bitvavo, of schrijf een onverkoopbare positie af.

### Melding "Onbekende orderuitkomst"

Soms weet de bot niet zeker of een order bij Bitvavo is uitgevoerd, bijvoorbeeld
als je internet precies tijdens het plaatsen wegvalt. Hij verstuurt de order dan
**nooit** blind opnieuw (dan zou hij misschien twee keer kopen of verkopen).

Bij een **kooporder** verschijnt bovenaan een gele balk **Onbekende
orderuitkomst**, en koopt de bot **niets meer, in geen enkele markt**. Elke ronde
zoekt hij de order op bij Bitvavo:

- Vindt hij de order, dan boekt hij wat er gekocht is als positie (mét stop-loss)
  en gaat hij verder.
- Meldt Bitvavo drie rondes op rij dat de order niet bestaat, én is de order
  minstens een minuut oud (bij een langere rondetijd: minstens drie rondes), dan
  is hij niet geplaatst en gaat de bot ook verder. Snel stoppen en starten of de
  bot herstarten maakt die wachttijd niet korter, en tijdens de Noodstop telt
  "niet gevonden" niet mee.

Wil je niet wachten? Kijk dan zelf op Bitvavo bij je **open orders** en je
**saldo** of er iets gekocht is. Klik daarna op **Ik heb het gecontroleerd**. Let
op: munten die zo'n order toch gekocht heeft, beheert de bot dan **niet** (geen
stop-loss). Verkoop die zelf op Bitvavo.

Bij een **verkooporder** met onbekende uitkomst verkoopt de bot die positie niet
nog een keer, totdat vaststaat wat er met de eerste order gebeurd is (volgens
dezelfde regels). Zo'n positie kun je in die tijd ook niet afschrijven.

Was het opgeslagen bestand van de bot bij het starten kapot, dan zie je de
melding **Opgeslagen staat was onbruikbaar**. De bot begint dan met een lege
administratie (het oude bestand blijft bewaard) en bewaakt posities van vóór de
herstart niet. Live trading aanzetten kan pas als je je saldi op Bitvavo hebt
gecontroleerd en op **Ik heb het gecontroleerd** hebt geklikt. In de oefenmodus
gaat het alleen om je oefenposities en -trades (nep-geld): bevestig de melding
om verder te gaan.

## Backtesten vanaf de command line

```bash
npm run backtest -- --market BTC-EUR --interval 15m --days 30
npm run backtest -- --market ETH-EUR --interval 15m --days 60 --walkforward
npm run backtest -- --market SOL-EUR --interval 5m --days 14 --source simulated
```

Let op: de command line gebruikt altijd de **standaardinstellingen**, niet wat je
in het dashboard hebt opgeslagen. Wil je je eigen instellingen testen, gebruik
dan het Backtest-lab in het dashboard.

### Strategie-toernooi: welke werkt het best?

```bash
npm run tournament -- --source bitvavo
```

Test de bot en elk van de vijf strategieën apart, naast "gewoon kopen en
vasthouden", over **1 week, 1 maand, 1 jaar en 5 jaar**, op BTC, ETH, SOL, XRP en ADA
(elk met €50, fees en slippage meegerekend). Voor 1 en 5 jaar volgt een
**walk-forward-controle** op data die de strategie nog niet kende; kijk vooral
daarnaar, want "de beste achteraf" is vaak geluk. Opties: `--markets BTC-EUR,ETH-EUR`,
`--capital 50`, `--quick` (alleen week en maand), `--json uitvoer.json`.
Het ophalen van 5 jaar koersen duurt de eerste keer even; daarna staan ze in
`data/cache`.

## Hoe het in elkaar zit

```
Bitvavo REST ──▶ BitvavoFeed ─┐                        ┌─▶ PaperBroker (oefenen)
(of simulator) ─▶ SimulatedFeed┴─▶ TradingEngine ──────┤
                                   │  indicators        └─▶ LiveBroker ──▶ Bitvavo API
                                   │  5 strategieën + ensemble
                                   │  RiskManager
                                   │  koersbewaking als de bot stilstaat
                                   └─▶ events ──▶ SSE ──▶ dashboard (browser)
Backtester gebruikt exact dezelfde strategieën en RiskManager, en draait in
een aparte rekenthread (worker) zodat de bot blijft reageren.
```

| Map | Inhoud |
|---|---|
| `src/core` | Gedeelde types, standaardinstellingen, hulpfuncties |
| `src/exchange` | Bitvavo REST-client (HMAC-signing, rate limits, precisie) en de regel voor het beursminimum |
| `src/data` | Marktdata: Bitvavo-feed met cache, en de marktsimulator |
| `src/indicators` | EMA, RSI, MACD, Bollinger, ATR, ADX, Donchian, VWAP, … |
| `src/strategies` | De vijf strategieën, regime-detectie en het ensemble |
| `src/risk` | Positiegrootte, stops, limieten |
| `src/backtest` | Backtester, statistieken, optimizer, walk-forward |
| `src/broker` | Paper broker en live broker |
| `src/engine` | De trading-engine en opslag van de toestand (`data/`) |
| `src/server` | HTTP-server, API, live-updates (SSE), scanner, rekenthread voor backtests |
| `public/` | Het dashboard (HTML/CSS/JS, grafieken via TradingView Lightweight Charts) |
| `tests/` | Automatische tests, ook voor het dashboard (`tests/frontend`) |

Het volledige technische contract tussen de modules staat in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```bash
npm test           # unit tests
npm run typecheck  # TypeScript-controle
```

## Beperkingen: eerlijk is eerlijk

- **De bot moet blijven draaien.** Stop-losses worden door de bot bewaakt, niet
  als order op de beurs gezet. Gaat je computer in slaapstand of valt internet weg,
  dan worden stops pas uitgevoerd als de bot weer draait. Heb je op Stop of
  Noodstop gedrukt, dan ververst het dashboard nog wel de koersen, maar voert de
  bot **geen** stops uit tot je hem weer start.
- **Een stop-loss is geen garantie.** De bot verkoopt tegen marktprijs zodra de
  stop geraakt is. Zakt de koers in één klap door je stop heen (een "gat"), dan
  verkoop je lager en kan het verlies groter zijn dan 1,5%.
- **Alleen long**: de bot koopt en verkoopt. Short gaan (verdienen aan dalingen)
  kan niet op de spotmarkt van Bitvavo.
- **Market orders** betalen de hogere taker fee (0,25%).
- **De simulator is geen echte markt.** Goede resultaten op gesimuleerde data
  zeggen niets over echte winstgevendheid.
- **Backtests kijken terug.** Ook een goede walk-forward-test is geen garantie
  voor de toekomst.
