# Trading-kennisbank: funded account €50.000 (MetaTrader 5)

Opgebouwd op 14 september 2026. Doel: een €50.000 funded account (prop-firm
challenge) halen en daarna consistent winstgevend blijven, met MetaTrader 5
als platform.

Lees in deze volgorde:

| # | Bestand | Wat je eruit haalt |
|---|---|---|
| 1 | [01-funded-account-plan.md](01-funded-account-plan.md) | Welke prop firm, de exacte regels voor €50k, het stappenplan om te slagen |
| 2 | [02-metatrader5-handboek.md](02-metatrader5-handboek.md) | Alles van MT5: orders, uitvoering, strategy tester, MQL5, valkuilen |
| 3 | [03-risicomanagement-50k.md](03-risicomanagement-50k.md) | Positiegrootte-tabellen voor €50k, dagbudget, drawdown-wiskunde |
| 4 | [04-strategieen.md](04-strategieen.md) | Drie concrete setups met entry/stop/target-regels |
| 5 | [05-psychologie-en-dagroutine.md](05-psychologie-en-dagroutine.md) | Dagroutine, checklists, de fouten die 86% laten falen |
| 6 | [06-marktvooruitblik-2026-09-15.md](06-marktvooruitblik-2026-09-15.md) | Kansen en agenda voor dinsdag 15 september 2026 (Fed-week) |
| 7 | [07-trading-journal.md](07-trading-journal.md) | Journal-template en wekelijkse review |
| 8 | [mql5/PropRiskCalculator.mq5](mql5/PropRiskCalculator.mq5) | MT5-script: lotgrootte uit risico-% en stop-afstand |
| 9 | [mql5/PropFirmGuard.mq5](mql5/PropFirmGuard.mq5) | MT5-EA: bewaakt dag- en totaalverlies, sluit alles bij je eigen limiet |

## De drie regels die alles bepalen

1. **Je overleeft de challenge door niet te verliezen, niet door veel te winnen.**
   De meeste uitval gebeurt in de eerste week via het daglimiet (5%), niet
   door het missen van het winstdoel.
2. **Risico per trade: 0,25% tot 0,5% van het account (€125 tot €250).**
   Nooit meer dan 1% (€500), ook niet op een "zekere" setup.
3. **Eigen daglimiet van 2% (€1.000) en dan het platform dicht.** De
   firm-limiet van €2.500 is de rand van de afgrond, niet je werkgebied.

## Eerlijke verwachting

Uit de cijfers van prop firms zelf: ongeveer 5 tot 14% haalt een challenge,
en 1 tot 2% van alle deelnemers krijgt ooit een uitbetaling. Dat komt niet
door slechte strategieën maar door gedrag onder druk: verdubbelen na verlies,
overtraden, te grote posities. Deze kennisbank is daarom voor de helft
risicobeheer en discipline.

Niets hierin is beleggingsadvies. Handelen met hefboom kan tot verlies van
je inleg (de challenge-fee) leiden. Test alles eerst op een demo-account.

## Bronnen (geraadpleegd 14 september 2026)

- FTMO-regels 2026: [MerlinTrade](https://merlintrade.io/prop-firms/ftmo),
  [PropJournal](https://propjournal.net/prop-firms/ftmo/rules),
  [TradingFinder](https://tradingfinder.com/props/ftmo/rules/),
  [FTMO FAQ nieuws](https://ftmo.com/en/faq/can-i-trade-news/),
  [FTMO Swing](https://ftmo.com/en/faq/ftmo-swing-account-type/),
  [FTMO fees](https://www.jptradingcapital.com/blog/en/ftmo-challenge-cost)
- Vergelijking prop firms: [TradeZella](https://www.tradezella.com/blog/best-prop-firms-2026-rankings),
  [Traders Second Brain](https://traderssecondbrain.com/guides/best-prop-firms-2026),
  [FundedNext prijzen](https://proptradingvibes.com/blog/fundednext-pricing)
- Slagingspercentages: [Finance Magnates](https://www.financemagnates.com/forex/only-1-in-20-traders-pass-prop-firm-challenges-reports-the-funded-trader/),
  [hoc-trade](https://hoc-trade.com/blogs/trading-psychology/prop-firm-challenge-why-fail),
  [Fortunly](https://fortunly.com/statistics/prop-firm-challenge-pass-rate-statistics/)
- Markt en agenda: [CNBC CPI augustus](https://www.cnbc.com/2026/09/11/cpi-inflation-report-august-2026.html),
  [CNBC week vooruit](https://www.cnbc.com/2026/09/11/stock-market-next-week-outlook-for-sept-14-18-2026.html),
  [FedRateCalc FOMC](https://fedratecalc.com/fomc-meeting-schedule/september-2026/),
  [Newsquawk week ahead](https://global-view.com/newsquawk-week-ahead-in-focus-14-18th-september-2026/),
  [CNBC ECB](https://www.cnbc.com/2026/09/10/ecb-interest-rate-hike-lagarde-iran.html),
  [Bank of England](https://www.financecalendar.com/bank-of-england-mpc-meetings/),
  [BoJ via FXStreet](https://www.fxstreet.com/news/boj-sets-to-raise-interest-rates-by-25-bps-next-week-reuters-202609110259),
  [Retail sales](https://www.financecalendar.com/event/us-retail-sales-august-2026/),
  [EUR/USD](https://www.exchangerates.org.uk/news/47165/2026-09-12-euro-to-dollar-forecast-route-to-1-20-just-became-harder.html),
  [Goud](https://tradingeconomics.com/commodity/gold),
  [Olie](https://www.psuconnect.in/market/crude-oil-price-today-12-september-2026-brent-holds-near-104-wti-at-100),
  [DAX](https://tradingeconomics.com/germany/stock-market),
  [Bund](https://tradingeconomics.com/germany/government-bond-yield)
- MetaTrader 5: [Release notes](https://www.metatrader5.com/en/releasenotes),
  [Strategy tester](https://www.metatrader5.com/en/terminal/help/algotrading/testing),
  [Build 6180 AI-functies](https://www.mql5.com/en/forum/515552)
