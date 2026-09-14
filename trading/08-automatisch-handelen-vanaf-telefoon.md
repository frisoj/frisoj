# 08 · Automatisch laten handelen (demo) als je alleen een telefoon hebt

## Wat de MT5-app op je telefoon wél en niet kan

| Kan wel | Kan niet |
|---|---|
| Inloggen op demo/challenge, koersen, grafieken met indicatoren | Expert Advisors (robots) of scripts draaien |
| Handmatig orders plaatsen, SL/TP verplaatsen | EA's installeren of compileren |
| Alerts en push-meldingen ontvangen | Strategy Tester |
| Handelsgeschiedenis bekijken | Verbinding met Claude of een andere AI |

Automatisch handelen in MT5 gebeurt uitsluitend via een EA op een
**desktop-terminal** (Windows, of Mac/Linux via Wine) of op een **VPS**.
Ik kan zelf geen orders plaatsen: ik heb geen toegang tot je account en dat
is ook goed zo. Wat ik wel kan is de EA schrijven die volgens jouw regels
handelt; die staat nu in `mql5/PropDemoTrader.mq5`.

## Route A · Volledig vanaf je telefoon: Windows-VPS + Remote Desktop

Dit is de enige route zonder pc. Kosten: ca. €5 tot €15 per maand.

1. **Huur een Windows-VPS** (bijv. Contabo, Hetzner Windows, ForexVPS,
   of MetaQuotes' eigen "MQL5 VPS" kan pas ná stap 4). Kies een locatie
   dicht bij de server van je firm (FTMO: Londen/Frankfurt).
2. **Installeer de app "Microsoft Remote Desktop"** (iOS/Android) en log
   in op de VPS met het IP en wachtwoord van de provider. Je ziet nu een
   Windows-bureaublad op je telefoon (draai je scherm horizontaal).
3. **Installeer MT5 op de VPS**: open Edge op de VPS, ga naar de
   downloadpagina van je firm (FTMO: client area → Platforms) en
   installeer. Log in met je demo-gegevens.
4. **Zet de EA erop**:
   - Open op de VPS in Edge:
     `https://github.com/frisoj/frisoj/blob/claude/funded-account-trading-dg9e0u/trading/mql5/PropDemoTrader.mq5`
     → knop "Raw" → rechtermuisknop "Opslaan als" → sla op als
     `PropDemoTrader.mq5`.
   - In MT5: Bestand → Open datamap → `MQL5\Experts\` → plak het bestand.
     Doe hetzelfde met `PropFirmGuard.mq5`.
   - In MT5: Extra → MetaQuotes Language Editor (F4) → open het bestand →
     Compileren (F7). Onderin moet "0 error(s)" staan.
   - Terug in MT5: Navigator (Ctrl+N) → Expert Advisors → sleep
     `PropDemoTrader` op een **M15-grafiek van EURUSD**. Vink in het
     venster "Automatisch handelen toestaan" aan. Herhaal voor XAUUSD
     en GER40 als je die wilt.
   - Sleep `PropFirmGuard` op één willekeurige grafiek.
   - Knop **Algo Trading** in de werkbalk moet groen zijn.
5. **Sluit Remote Desktop.** De VPS blijft draaien; de EA handelt door.
6. **Volgen vanaf je telefoon**: log met dezelfde demo-gegevens in op de
   MT5-app. Je ziet de posities die de EA opent en kunt ingrijpen.
   Push-meldingen: in MT5 op de VPS Extra → Opties → Meldingen →
   MetaQuotes-ID uit de app invullen.

## Route B · Eén keer een pc lenen, daarna MQL5 VPS

Als je een keer een Windows-pc kunt gebruiken (familie, bibliotheek):
stappen 3 en 4 daarop, en dan in MT5 Navigator → rechtermuisknop op je
account → **Registreer virtuele server** (ca. $15 per maand). Kies
"Migreer alles". Je EA draait daarna in het datacenter van MetaQuotes,
de pc mag uit, en je volgt alles via de app.

## Wat PropDemoTrader precies doet

- Handelt **setup A** (trend-pullback): H1-trend via EMA 20/50, entry op
  een M15-afwijzingscandle in de EMA-zone, stop onder/boven de swing plus
  1 × ATR, target 2R, break-even bij +1R.
- Risico **0,5% van equity** per trade, berekend met de echte
  symboolgegevens van de broker; slaat de trade over als de stop groter
  is dan 3 × ATR of als het minimum-lot je budget overschrijdt.
- **Maximaal 1 trade per dag per symbool**, alleen tussen 08:00 en 17:00
  servertijd, nooit in het weekend, vrijdag na 21:00 alles dicht.
- **Eigen daglimiet 2%** en totaallimiet 6%: sluit zijn eigen posities en
  handelt die dag niet meer.
- Geen nieuwsfilter. Op een demo maakt dat niet uit; op een funded
  Normal-account zou je hem rond high-impact nieuws moeten pauzeren
  (Algo Trading-knop uit) of de Swing-variant kiezen.

## Verwachting en volgorde

1. Eerst **Strategy Tester** (Ctrl+R) op de VPS: EURUSD M15, 2 jaar,
   "Elke tick op basis van echte ticks", deposito 50.000 EUR. Kijk naar
   profit factor, max drawdown en aantal trades (zie handboek §8).
2. Dan **4 weken demo**. Exporteer wekelijks het rapport naar `trading/`
   in de repository (of stuur het mij) en ik analyseer de resultaten en
   pas de EA aan.
3. Pas als tester én demo positief zijn met max drawdown onder 6%:
   overwegen voor een challenge, en dan nog met 0,25% risico de eerste
   twee weken.

Een EA die morgen op demo gaat draaien is een experiment, geen inkomen.
De regels in de EA voorkomen dat het een duur experiment wordt.
