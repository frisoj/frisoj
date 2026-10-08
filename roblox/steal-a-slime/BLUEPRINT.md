# Blauwdruk: Steal a Slime

Dit is het bouwplan voor de tweede Roblox-game. Het staat hier zodat elke keuze terug te vinden is.

## 1. Wat het onderzoek liet zien (oktober 2026)

Roblox publiceert geen omzet per game. Alle cijfers hieronder zijn schattingen van trackers.

| Game | Wat spelers doen | Waar ze voor betalen |
|---|---|---|
| **Steal An Egg** (~1,2 mln spelers tegelijk, 7 okt 2026, #1) | Eieren stelen uit biomen, naar je hok brengen, laten uitkomen, 3 dezelfde fuseren | 2x Money (399), 2x Growth (467), Instant Hatch (~9 per ei) |
| **Steal a Brainrot** (#1 mobiele omzet jan 2026, ~$3-7 mln/maand) | Units kopen van een loopband, ze verdienen geld per seconde, units van anderen stelen, basis op slot, rebirths | VIP, 2x Money, Server Luck, Lucky Blocks, geldpakketten (59-759 R$), admin (1999 R$) |
| **Grow a Garden** ($12 mln in mei 2025) | Zaden planten, weer-events geven mutaties (×2 tot ×50) die stapelen | Zaden, gereedschap, dieren, valuta |
| **Rivals, Blox Fruits, Brookhaven, Adopt Me, Pet Sim 99** ($4-15 mln/maand) | Shooter, avontuur, rollenspel, huisdieren | Skins, gamepasses, eieren, limited items |

**Wat die toppers gemeen hebben**
1. **Geld per seconde.** Je ziet je inkomen elke seconde stijgen; dat houdt je vast.
2. **Zeldzaamheid en jagen.** Een Mythic die langskomt geeft de hele server een rush.
3. **Sociale spanning.** Stelen en verdedigen zorgt voor verhalen en clips op TikTok.
4. **Weer en mutaties.** Willekeurige events (×2 tot ×50) laten spelers terugkomen en blijven.
5. **Fuseren en rebirths.** Altijd een volgend doel.
6. **Veel kleine dingen te koop.** Passes voor altijd, plus producten voor nu (geld, geluk, events overslaan).

**Spelregels van Roblox die we volgen**
- **Paid random items:** iets willekeurigs dat je met Robux koopt (eieren), of iets dat je kans verhoogt (Server Luck), moet alle uitkomsten met echte percentages tonen. Die moeten optellen tot 100%, achter een knop met tekst ("ODDS"), vóór de aankoop. Spelers die dit volgens `PolicyService` niet mogen kopen, zien de eieren niet.
- **Creator Rewards:** Roblox betaalt 5 Robux per "Active Spender" die op een dag 10+ minuten in je game speelt. Daarom zitten er speeltijd-cadeaus tot 60 minuten in en een dagelijkse beloning.

Bronnen: [RoWatcher top 10](https://rowatcher.com/news/the-10-highest-earning-roblox-games-in-2026-and-what-they-mean-for-the-platform), [Steal An Egg gamepasses](https://stealanegg.fandom.com/wiki/Gamepasses), [Steal a Brainrot items en passes](https://deltiasgaming.com/roblox-steal-a-brainrot-all-gear-and-game-passes), [Steal a Brainrot rebirth/lock](https://www.sportskeeda.com/roblox-news/steal-brainrot-rebirth-16-guide), [Grow a Garden omzet](https://www.calcalistech.com/ctechnews/article/dj4lxef8r), [Paid random items](https://create.roblox.com/docs/production/monetization/paid-random-items), [Creator Rewards](https://devforum.roblox.com/t/introducing-creator-rewards-earn-more-by-growing-the-community/3777628), [spelers live](https://levelupplay.my/charts/top-playing).

## 2. Het idee

**Steal a Slime**: in een kleurrijk slijmlab op een zwevend eiland stroomt een rivier van glanzende slijmpjes voorbij. Je koopt ze met **Goo**, ze springen naar jouw lab en maken daar Goo per seconde. Andere spelers kunnen ze uit je lab stelen. Jij steelt terug.

Wat het eigen maakt, bovenop de bekende lus:
- **Slijmpjes zijn levendig.** Ze springen met squash-en-stretch, glimmen en hebben petjes, hoorns en kronen. Mutaties zijn echt te zien: goud, diamant, snoep, lava, galaxy en regenboog met eigen effecten.
- **Fuseren:** 3 dezelfde → een **Giant** (×4), 3 Giants → een **Titan** (×16). Elk niveau is groter.
- **Weer van de Goo-storm:** elke 6 minuten een storm die slijmpjes muteert (×2 tot ×15), ook in je eigen lab.
- **Bonker:** iedereen krijgt een zachte hamer. Raak een dief en het slijmpje springt terug naar huis.
- **Slijmdex:** elke nieuwe soort of mutatie geeft blijvend extra inkomen.

## 3. De spellus

1. **Kopen:** loop naar de Goo-rivier en houd **E** bij een slijmpje dat je wilt (prijs, inkomen en zeldzaamheid staan erboven). Het springt naar een vrij platform in je lab.
2. **Verdienen:** elk slijmpje vult de **Goo-tank** van je lab. Stap op de **Collect Pad** om te innen (Auto Collect-pass: gaat vanzelf).
3. **Stelen:** loop een ander lab in en houd **E** (2 s) bij een slijmpje. Je draagt het boven je hoofd en loopt trager. Breng het naar jouw lab. De eigenaar krijgt alarm.
4. **Verdedigen:** stap op de **Lock-knop** voor een laserpoort (60 s). Of bonk de dief: dan gaat het slijmpje terug.
5. **Fuseren:** zet 3 dezelfde in de **Fuse Machine**: na 45 s heb je een Giant.
6. **Rebirth:** bij genoeg Goo plus een bepaalde zeldzaamheid begin je opnieuw met +50% inkomen, +1 platform en +5 s lock.

## 4. Slijmpjes en economie

| Zeldzaamheid | Kans op de rivier | Soorten (Goo/s, prijs) |
|---|---|---|
| Common | 52% | Gloop (1, 12), Bubbles (2, 28), Mossy (3, 45) |
| Uncommon | 26% | Jellybean (6, 140), Puddle Pup (9, 230), Sprout (13, 360) |
| Rare | 13% | Bouncer (28, 1,1K), Frosty (42, 1,9K), Sparky (65, 3,2K) |
| Epic | 6% | Ninja Goo (140, 11K), Pirate Goo (210, 18K), Lava Lump (320, 30K) |
| Legendary | 2,4% | King Gloop (800, 110K), Unicorn Goo (1,25K, 190K), Dragon Drip (2K, 340K) |
| Mythic | 0,5% | Galaxy Gel (6K, 1,4M), Cyber Slime (9,5K, 2,4M), Phoenix Puff (15K, 4,2M) |
| Godly | 0,09% | Slime God (60K, 25M), Goo Kraken (100K, 48M) |
| Secret | 0,01% | Void Blob (450K, 300M), Rainbow Royale (800K, 600M) |

Binnen een zeldzaamheid is de duurste soort het zeldzaamst (verdeling 5:3:2, of 3:2).
**Terugverdientijd** loopt op van ~12 s (Common) tot ~12 min (Secret), zodat er altijd een volgend doel is.

- **Rivier:** elke 2,4 s een nieuw slijmpje, 7 studs/s, ~47 s lang zichtbaar.
- **Gegarandeerd:** elke 4 minuten een Legendary of beter, elke 12 minuten een Mythic of beter. Dat wordt aangekondigd in de hele server.
- **Mutaties (Goo-storm):** Gold ×2, Diamond ×3, Candy ×4, Lava ×6, Galaxy ×10, Rainbow ×15. Een storm komt elke 6 minuten en duurt 100 s. Tijdens een storm:
  - krijgt 30% van de nieuwe rivier-slijmpjes de mutatie;
  - heeft elk slijmpje in je lab elke 10 s 3% kans geraakt te worden (Lucky Charm: 6%).
  Buiten stormen is 2% van de rivier-slijmpjes Gold.
- **Inkomen per slijmpje** = basis × mutatie × fusie (×1, ×4, ×16).
- **Totaal inkomen** = som × (1 + 0,5 per rebirth) × (1 + Slijmdex-bonus) × passes (2x Goo, VIP +50%) × vriendenbonus (+10% per vriend, max +40%) × Slime Storm Saturday (×2).
- **Offline:** je lab verdient 50% door, maximaal 8 uur.

**Rebirths (10)**

| # | Goo nodig | En je bezit |
|---|---|---|
| 1 | 250K | een Epic |
| 2 | 1,5M | een Legendary |
| 3 | 8M | een Legendary |
| 4 | 40M | een Mythic |
| 5 | 200M | een Mythic |
| 6 | 1B | een Mythic Giant |
| 7 | 5B | een Godly |
| 8 | 25B | een Godly |
| 9 | 120B | een Secret |
| 10 | 600B | een Secret |

## 5. Stelen en verdedigen

- Bij binnenkomst zit je lab 30 s op slot. Daarna start de Lock-knop elke keer 60 s slot (+5 s per rebirth; ×2 met Laser Lock+). Door de laserpoort kan alleen de eigenaar.
- Stelen: 2 s E vasthouden (Thief Gloves: 0,6 s). Je loopt dan op 60% snelheid (gloves: 85%) en het slijmpje zweeft boven je hoofd. Je kunt alleen stelen als je zelf een vrij platform hebt.
- Afleveren: loop jouw lab in. Pas dan wisselt het slijmpje echt van eigenaar en wordt het opgeslagen.
- Terug naar huis: als de dief gebonkt wordt, doodgaat, de game verlaat of na 45 s.
- Bonker: 0,9 s cooldown en 9 studs bereik. Raak je geen dief, dan duw je iemand alleen zachtjes weg.

## 6. Verdienmodel

**Game Passes (voor altijd)**

| Pass | Prijs | Wat je krijgt |
|---|---|---|
| VIP | 299 R$ | +50% Goo, +1 gouden platform, +15 s lock, VIP-tag in de chat |
| 2x Goo | 449 R$ | Dubbel inkomen |
| Auto Collect | 199 R$ | Goo gaat vanzelf naar je saldo |
| Mega Lab | 349 R$ | +6 platforms |
| Speed Boots | 179 R$ | +35% loopsnelheid, +20% sprong |
| Thief Gloves | 249 R$ | Stelen in 0,6 s, dragen op 85% snelheid |
| Laser Lock+ | 199 R$ | Je slot duurt 2x zo lang |
| Lucky Charm | 399 R$ | 2x geluk in eieren, 2x kans op stormmutaties in je lab (3% → 6%) |

**Developer Products (steeds opnieuw te kopen)**

| Product | Prijs | Wat je krijgt |
|---|---|---|
| Goo Pack S / M / L / XL | 29 / 99 / 299 / 799 R$ | 15 min / 1 uur / 4 uur / 12 uur van je inkomen (minimaal 500 / 5K / 50K / 500K) |
| Lucky Egg | 79 R$ | Willekeurig slijmpje, Rare of beter (kansen in de game) |
| Mega Egg | 249 R$ | Willekeurig slijmpje, Legendary of beter (kansen in de game) |
| Server Luck x2 | 99 R$ | 15 min dubbele kans op zeldzame slijmpjes voor de hele server; jouw naam wordt omgeroepen |
| Server Luck x5 | 349 R$ | Hetzelfde, ×5 |
| Gold Rush | 99 R$ | Start nu een Gold-storm voor de hele server |
| Rainbow Surge | 349 R$ | Start nu een Rainbow-storm (×15) voor de hele server |
| Lab Shield | 59 R$ | 5 minuten niemand kan stelen |
| Skip Fusion | 19 R$ | Fusie direct klaar |

**Gratis beloningen** (houden spelers langer en vaker in de game): speeltijd-cadeaus na 1, 3, 5, 8, 12, 16, 20, 30, 45 en 60 minuten (de laatste is een gratis Lucky Egg), een dagelijkse beloning met een reeks van 7 dagen, codes, en de **Slime Storm Saturday** (elke zaterdag 18:00-18:30 UTC ×2 Goo en ×2 geluk).

## 7. De wereld

- **Zwevend eiland** met paarse kliffen, reuzenpaddenstoelen, kristallen, goo-watervallen en bruggen. Belichting: Future-licht, Atmosphere, Bloom, ColorCorrection en SunRays.
- **Goo-rivier** in het midden: een glanzende snoepkleurige baan van de **Slime Portal** naar de **Recycler**, met lantaarns en bruggetjes.
- **8 labs**, aan elke kant van de rivier 4. Elk lab heeft:
  - een vloer met 25 platforms (5×5): eerst 8 open, de rest gaat open door rebirths of passes;
  - een glazen koepel met neonrand in de kleur van het lab;
  - een laserpoort, Lock-knop, Collect Pad met Goo-tank, Fuse Machine en een bord met naam en inkomen.
- **Plein** met Shop-kiosk, Rebirth-altaar, Slijmdex-bord, codeterminal en twee ranglijsten (meeste Goo, meeste diefstallen).

## 8. Techniek

- Rojo + Luau `--!strict`. De map wordt bij het bouwen met Lune gegenereerd. Zelfde bouwstraat als Ride a Sky Whale: typecheck, tests, automatisch publiceren.
- **Slijmpjes tekent de client.** De server houdt alleen de toestand bij:
  - rivier: een map met data en spawntijd;
  - platforms: attributen.
  De client bouwt het model en animeert het. Dat is vloeiend en goedkoop voor de server.
- **De server controleert alles.** Bij kopen rekent de server zelf uit waar het slijmpje nu is (uit spawntijd en snelheid) en checkt hij de afstand. Bij stelen checkt hij de vasthoudtijd, het slot, het schild en de afstand. Bonken heeft een cooldown en een afstandscheck.
- **Opslaan:** DataStore met een sessie-slot (uit Ride a Sky Whale) en idempotente ProcessReceipt.
- **Ranglijsten:** OrderedDataStore, elke 2 minuten bijgewerkt.

## 9. Lancering

1. Publiceer, vul de vragenlijst in en zet de game na de wachttijd op Public. Icoon, thumbnail en trailer staan in `marketing/`.
2. Start met **Sponsored Experiences** in Roblox Ads Manager (een klein dagbudget, bijvoorbeeld 500-1000 Robux per dag) en kijk naar de speeltijd per bezoek.
3. Elke week een update: een nieuwe soort of storm en een nieuwe code. Elke zaterdag Slime Storm Saturday.
4. Korte clips (stelen, Mythic op de rivier, Rainbow-storm) op TikTok en YouTube Shorts.
5. Test thumbnails met de thumbnail-experimenten in de Creator Hub.

Duizenden spelers kan niemand beloven. Wat dit plan doet, is alles meenemen wat de huidige toppers groot maakte: een duidelijke lus, sociale spanning, events en veel kleine aankopen.
