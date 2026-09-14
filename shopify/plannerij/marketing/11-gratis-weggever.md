# 11 · Gratis weggever — Plannerij Gratis Weekplanner + Gewoontetracker

De gratis download waarmee de winkel een e-maillijst opbouwt. Dit document
beschrijft wat er live staat, hoe de weggever in de trechter past, wat jij nog
handmatig moet doen en waar je hem promoot.

---

## 1. Wat er live staat

**Landingspagina**
- https://umaktx-cz.myshopify.com/pages/gratis-weekplanner
- Korte URL: https://umaktx-cz.myshopify.com/gratis (de omleiding `/gratis` →
  `/pages/gratis-weekplanner` staat er al)
- Handle `gratis-weekplanner`, gepubliceerd, standaardsjabloon (geen
  templateSuffix, zodat hij in elk thema werkt)
- Inhoud: wat je krijgt, twee directe downloadlinks (A4 en A5), de uitnodiging om
  je in te schrijven, korte gebruiksuitleg en links naar alle vijf betaalde
  producten

**Product (gratis, €0,00)**
- https://umaktx-cz.myshopify.com/products/gratis-weekplanner-gewoontetracker
- Handle `gratis-weekplanner-gewoontetracker`, status **ACTIVE** én gepubliceerd
  op het verkoopkanaal Webshop (`gid://shopify/Publication/363977015638`)
- Prijs €0,00, sku `PL-GRATIS-WEEK`, voorraad niet bijgehouden, geen verzending,
  niet belastbaar → altijd te bestellen
- Collectie: **Planners**
- Vier productafbeeldingen (1600×1600, zonder ingebakken titel of merknaam, het
  thema zet zijn eigen koppen erover)
- SEO-titel: "Gratis weekplanner + gewoontetracker (A4/A5) | Plannerij"
- Tags: gratis, weekplanner, gewoontetracker, brain dump, ongedateerd, printable,
  a4, a5, download

**Bestanden in Shopify → Content → Bestanden**

| Bestand | URL |
|---|---|
| A4 pdf | https://cdn.shopify.com/s/files/1/1062/7671/6886/files/Plannerij-Gratis-Weekplanner-A4.pdf?v=1789338366 |
| A5 pdf | https://cdn.shopify.com/s/files/1/1062/7671/6886/files/Plannerij-Gratis-Weekplanner-A5.pdf?v=1789338365 |
| Afbeelding 1 (hero) | https://cdn.shopify.com/s/files/1/1062/7671/6886/files/gratis-1-hero.png?v=1789338366 |
| Afbeelding 2 (weekplanner) | https://cdn.shopify.com/s/files/1/1062/7671/6886/files/gratis-2-weekplanner.png?v=1789338365 |
| Afbeelding 3 (gewoontetracker) | https://cdn.shopify.com/s/files/1/1062/7671/6886/files/gratis-3-gewoontetracker.png?v=1789338368 |
| Afbeelding 4 (alle pagina's) | https://cdn.shopify.com/s/files/1/1062/7671/6886/files/gratis-4-alle-paginas.png?v=1789338366 |

**In deze repo**
- `producten/Plannerij-Gratis-Weekplanner-A4.pdf` en `-A5.pdf`
- `afbeeldingen/gratis-1-hero.png` t/m `gratis-4-alle-paginas.png`
- Opnieuw genereren: `cd generators && python3 make_gratis.py` (pdf's) en
  `python3 make_gratis_mockups.py` (afbeeldingen)

**Wat er in de pdf zit** — vier ongedateerde pagina's, A4 én A5:
1. Weekplanner (ma t/m zo, veld voor het weeknummer, drie prioriteiten, vak voor
   losse notities)
2. Gewoontetracker voor een maand (31 dagen, zestien gewoontes, twee
   terugblikvakken)
3. Brain dump met stippenraster en de sorteervakken nu doen / later plannen /
   loslaten
4. "Zo gebruik je deze planner" met printtip, een verwijzing naar de betaalde
   producten en onderaan de winkel-URL

---

## 2. Hoe de weggever in de trechter past

```
Pinterest · Instagram/TikTok · blog · Google
                 ↓
     /gratis  →  landingspagina
                 ↓                    ↘
   directe download (A4/A5)        gratis bestelling €0,00
   geen e-mail nodig                e-mailadres + toestemming
                 ↓                    ↓
        merk leren kennen        welkomstflow (04-email.md)
                                      ↓
                                 WELKOM10 (10%)
                                      ↓
                Printable Bundel €7,95 · Digitale Planner 2027 €14,95
                                      ↓
                            Complete Bundel 2027 €29,95
```

De pagina biedt bewust **twee routes**:

- **Directe downloadlinks.** Laagste drempel, goed voor bereik en voor delen op
  Pinterest en in blogartikelen. Je vangt geen e-mailadres, maar de pdf zelf
  verwijst op pagina 4 terug naar de winkel.
- **De gratis bestelling.** Wie het product bestelt, laat zijn e-mailadres achter
  en kan bij het afrekenen aanvinken dat hij mail wil ontvangen. Dát is de
  lijstopbouw. Daarom staat die link prominent op de pagina en op het product.

De weggever is ook het logische eerste product in de winkel: hij staat in de
collectie Planners, dus wie rondkijkt komt hem tegen zonder dat je iets extra's
hoeft in te richten.

---

## 3. Wat jij nog handmatig moet doen

### a. Het bestand koppelen in de app Digital Products (verplicht)

Zonder deze stap krijgt iemand die de gratis bestelling plaatst géén
downloadmail. De directe links op de landingspagina werken wel, maar dan bouw je
geen lijst op. Net als bij de vijf betaalde producten doe je dit één keer in de
app. De knopteksten kunnen in het Engels staan; tussen haakjes staat de
Engelse variant.

1. Ga naar **Shopify-beheer → Apps → Digital Products**.
2. Klik op **Digitaal product toevoegen** (*Add digital product*) en kies
   **bestaand product** (*Select existing product*). Zoek op *Gratis*.
3. Kies **Gratis Weekplanner + Gewoontetracker**. Er is één variant
   (*Default Title*); die staat automatisch geselecteerd.
4. Klik op **Bestand uploaden** (*Upload file*) en kies op je computer
   `producten/Plannerij-Gratis-Weekplanner-A4.pdf`.
5. Voeg met **Bestand toevoegen** (*Add another file*) ook
   `producten/Plannerij-Gratis-Weekplanner-A5.pdf` toe, zodat de klant beide
   formaten krijgt. Staat die knop er niet, maak dan eerst een zip met de twee
   pdf's en upload die — zo is het bij de betaalde producten ook gedaan.
6. Klik op **Opslaan** (*Save*).
7. Controleer het resultaat: open het product in **Producten → Gratis
   Weekplanner + Gewoontetracker**. Bij de variant hoort nu te staan dat er een
   digitaal bestand aan hangt.
8. **Test het.** Bestel het product zelf met je eigen e-mailadres. Omdat het
   €0,00 is, hoef je geen betaalgegevens in te vullen. Controleer of de
   downloadmail binnenkomt en of beide pdf's openen. Dit is precies de test die
   op 13 september ook voor de betaalde producten is gedaan (order #1001).

### b. Zorg dat het e-mailvinkje zichtbaar is

**Instellingen → Checkout → Klantcontact**: zet de optie aan waarmee klanten zich
tijdens het afrekenen kunnen aanmelden voor e-mailmarketing (in het Nederlands
meestal "Klanten kunnen zich aanmelden voor e-mailmarketing"). Zonder dat vinkje
krijg je wel het e-mailadres van de bestelling, maar geen toestemming om
nieuwsbrieven te sturen — en die toestemming heb je nodig.

### c. Zet de welkomstflow aan

De drie welkomstmails staan klaar in `marketing/04-email.md`. Koppel de flow aan
"heeft zich aangemeld voor e-mailmarketing", zodat iedereen die de gratis
download bestelt de flow in loopt. Stop de flow zodra iemand een betaald product
koopt.

### d. Optioneel, maar aan te raden

- Zet de gratis download op de homepage of in de aankondigingsbalk zodra thema v2
  gepubliceerd is (zie `winkel/CHECKLIST.md`, punt 1).
- Voeg `/gratis` toe aan je linkpagina `/pages/links` als hij er nog niet op
  staat.

---

## 4. Vijf plekken om de weggever te promoten

1. **Pinterest.** Het sterkste kanaal voor printables. Maak van elke pagina een
   losse pin (de vier mockups in `afbeeldingen/` kun je rechtstreeks gebruiken)
   en laat ze allemaal naar `umaktx-cz.myshopify.com/gratis` wijzen. Pintitels
   zoals "Gratis weekplanner om te printen (A4 en A5)" en "Gratis
   gewoontetracker voor een maand". Werkwijze en planning staan in
   `02-pinterest.md`.
2. **Instagram en TikTok.** Zet `/gratis` in je bio (of via `/links`) en maak één
   video waarin je de vier pagina's laat zien en invult. In de caption en in de
   verhaalsticker verwijs je naar dezelfde korte URL. Zie `03-instagram-tiktok.md`
   voor de formats.
3. **Onder je blogartikelen.** De artikelen over weekplanning, de gewoontetracker
   en de brain dump gaan precies over deze pagina's. Zet onderaan die artikelen
   een blokje "Download de gratis weekplanner" met een link naar `/gratis`. Dat
   levert bezoekers op die al met het onderwerp bezig zijn.
4. **In de winkel zelf.** Een aankondigingsbalk ("Gratis weekplanner —
   downloaden"), een blok op de homepage en een regel in de footer. Het product
   staat al in de collectie Planners, dus wie rondkijkt ziet hem ook daar.
5. **Per e-mail, naar wie je al kent.** Stuur bestaande klanten en abonnees één
   korte mail met de gratis planner als bedankje — dezelfde opmaakregels als de
   andere mails in `04-email.md` — en voeg de link toe aan de bedankpagina na een
   bestelling en aan je e-mailhandtekening. Bestaande klanten delen zo'n gratis
   download vaak door.

---

## 5. Hoe je ziet of het werkt

- **Analyses → Rapporten → Verkopen per product**: het aantal bestellingen van de
  gratis weekplanner is het aantal nieuwe e-mailadressen via die route.
- **Klanten**: filter op "Accepteert marketing" om de groei van de lijst te
  volgen.
- **Online Store → Analyses**: bekijk de bezoeken op `/pages/gratis-weekplanner`
  om te zien welk kanaal bezoekers levert.
- Vergelijk daarna hoeveel van die abonnees later een betaald product kopen; dat
  bepaalt hoeveel het waard is om in Pinterest en advertenties te stoppen
  (`06-advertenties-later.md`).
