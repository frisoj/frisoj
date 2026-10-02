# Review-verslag (afgerond)

De bot is in vijf rondes door meerdere onafhankelijke agents doorgelicht (ronde 5: de uitbreiding naar 400 munten). Elke
ronde had drie stappen:

1. Vinden: reviewers zochten problemen, elk vanuit een eigen invalshoek.
2. Controleren: andere agents probeerden elke bevinding te weerleggen.
3. Repareren en nagaan: per module repareerde één agent de bevestigde problemen,
   en daarna controleerden weer andere agents of het echt opgelost was. Dat
   gebeurde met concrete scenario's, waaronder een nagebootste Bitvavo die orders
   weigert, deels vult of niet antwoordt.

## Verloop

| Ronde | Wat | Resultaat |
|---|---|---|
| 1 | 7 reviewers (geld-boekhouding, risico, eerlijkheid backtest, Bitvavo-API, beveiliging, dashboard, contracten). 75 bevindingen, na ontdubbelen 45. Critical/high elk door 3 controleurs, de rest door 1. | 40 bevestigd, 5 weerlegd. Alle 40 gerepareerd. Hercontrole: alle 12 critical/high opgelost. |
| 2 | Vervolgpunten tussen modules: onverkoopbare posities, orders met onbekende uitkomst, noodstop, rendement na afromen, dashboard. | 6 scenario-controles; 3 direct groen, de rest door naar ronde 3. |
| 3 | Onverkoopbaar altijd op de actuele koers, Bitvavo-fout 217, tijdregel voor onbekende orders, nieuw rendementsmodel, dashboard. | Regressiecontrole 8/8 groen. |
| 4 | Verse koersen terwijl de bot stilstaat, afschrijven alleen op verse data, marge rond €5, heen-en-weer wijzigen van de kapitaallimiet, Start geblokkeerd tijdens een noodstop, telefoonweergave. | Geldcontrole 16/16 groen. Het ernstige dashboardprobleem (vensters vielen op een telefoon buiten beeld) is opgelost en gecontroleerd. |

| 5 | De uitbreiding "veel munten" (tot 400, automatische muntkeuze, trendfilter, spreadlimiet, kansen-ranglijst, munten-radar): 5 reviewers (geldveiligheid, schaal en rate-limits met een nagebootste Bitvavo met 400 markten, backtest, instellingen en bijwerken vanaf v1, dashboard in een echte browser). Elke bevinding met een aantoonbaar script. | 23 bevindingen (1 hoog, 7 middel, 15 laag). 22 opgelost en opnieuw gecontroleerd, 1 deels (zie hieronder). |

Tests: van 534 naar 1438, allemaal groen, plus een TypeScript-controle zonder fouten.

## Belangrijkste reparaties

- **Posities blijven verkoopbaar.** De bot maakt een positie zo groot dat hij bij
  de stop-loss nog boven Bitvavo's minimum van €5 zit. Zakt een positie door een
  koerssprong toch onder €5, dan probeert de bot niet eindeloos opnieuw te
  verkopen. Hij toont "Onverkoopbaar", en jij kunt de positie afschrijven. Dat
  wordt altijd eerst gecontroleerd met een verse koers en een vers saldo.
- **Orders met onbekende uitkomst**, bijvoorbeeld bij een netwerkfout:
  - De bot houdt het geld ervoor apart.
  - Hij stuurt de order nooit opnieuw.
  - Hij zoekt de order op bij Bitvavo voordat hij iets anders doet.
  - Hij geeft pas op na drie keer "niet gevonden" en minstens een minuut wachten.
  - Hij verkoopt nooit coins die je zelf hebt.
- **Noodstop en Stop:**
  - Ze houden ook een aankoop tegen die op dat moment al bezig is.
  - De noodstop meldt precies wat niet gesloten kon worden, en waarom.
  - Tijdens een noodstop kun je niet armen of starten.
  - Na een noodstop is de bot altijd gestopt en niet gearmd.
- **Kapitaallimiet:**
  - De bot gebruikt nooit meer dan de limiet.
  - Winst boven de limiet wordt apart gehouden en telt niet als verlies.
  - Het rendement klopt, ook na het wijzigen van de limiet.
  - De dagelijkse verlieslimiet rekent met het kapitaal waarmee echt gehandeld wordt.
- **Na een herstart:**
  - Dezelfde koop gebeurt niet nog een keer.
  - Een beschadigd statusbestand blokkeert armen totdat jij het bevestigt.
- **Backtest:** geen blik in de toekomst, fees en slippage (incl. spread) altijd
  meegerekend, en posities onder €5 worden net zo geweigerd als bij de echte beurs.
- **Beveiliging:**
  - Het dashboard is alleen bereikbaar vanaf je eigen computer.
  - Er is bescherming tegen DNS-rebinding en tegen verzoeken van andere websites.
  - Zware berekeningen draaien in een aparte thread, zodat de bot blijft reageren.

## Belangrijkste reparaties in ronde 5

- **Stop-losses blijven snel, ook met 400 munten.** Posities worden elke ronde als eerste
  bekeken; het scannen van andere munten heeft een tijdslimiet; loopt een ronde lang uit,
  dan worden de stops tussendoor opnieuw gecontroleerd. Een verkoop of noodstop mag een
  reserve van Bitvavo's verzoeken-budget gebruiken, zodat hij niet ~60 seconden hoeft te
  wachten (gemeten: van 60 s naar 0,4 s).
- **Trendfilter faalt veilig.** Kan de bot de Bitcoin-koers voor het filter niet ophalen,
  dan koopt hij niet (eerst liet hij nog een dag lang aankopen door op oude data).
- **Geen aankopen meer na een wijziging midden in een ronde** (oefengeld resetten, ander
  interval, andere muntenlijst).
- **Bijwerken vanaf v1:** je opgeslagen muntenlijst blijft gewoon staan; automatisch kiezen
  zet je zelf aan in Instellingen → Munten.

## Bekende kleine punten (niet opgelost, geen risico voor je geld)

- Met heel veel munten op een kort interval (bijv. 400 munten op 1-minuutcandles) haalt de
  bot niet elke munt elke candle. De radar zegt dat dan. Kies minder munten of een langer
  interval.

- Verhoog je de kapitaallimiet en verlaag je hem daarna weer, dan blijft het
  **rendement-%** gerekend op het hoogste bedrag dat ooit is ingelegd. Het bedrag in
  euro's klopt wel.
- Verlaag je de limiet terwijl er posities open staan, dan kan het **dag-%** voor die
  dag vreemd uitvallen. Dat is alleen de weergave; de verlieslimiet wordt daardoor
  alleen strenger.
- Bij een live-bot die niet gearmd is, kan het label "Onverkoopbaar" blijven staan
  nadat de coins weer vrij zijn. Afschrijven wordt dan wel correct geweigerd.
- Een paar logteksten zeggen "nieuwe poging bij de volgende tick" terwijl live niet
  gearmd is.
- Staat de bot 's nachts stil, dan springt "Vandaag" pas bij de volgende Start naar
  de nieuwe dag.
- Na een grote limietverhoging gevolgd door verlies kan de lijn in de equity-grafiek
  onder €0 zakken. "Max. daling" klopt wel.
- In de backtest-grafiek kunnen labels op een telefoonscherm overlappen.

## Wat niet getest kon worden

De koppeling met de **echte** Bitvavo-servers. Die waren vanuit de
ontwikkelomgeving niet bereikbaar. De client is gebouwd volgens Bitvavo's
API-documentatie en getest tegen een nagebootste Bitvavo. Volg daarom de eerste
keer de drie stappen in de README: eerst oefenen met echte koersen, dan live
zonder te armen, en pas daarna armen.
