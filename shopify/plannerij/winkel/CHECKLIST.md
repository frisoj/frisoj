# Plannerij – status en resterende stappen

Bijgewerkt op 14 september 2026, na de marketingronde.

## Opgeloste storingen op de live site

- **404 bij de collecties in het menu.** De vier collecties waren niet
  gepubliceerd op het verkoopkanaal Webshop, dus `/collections/planners` en de
  andere drie gaven "page not found". Alle vier staan nu gepubliceerd.
- **404 bij Over ons en Veelgestelde vragen.** Beide pagina's verwezen naar een
  sjabloon dat toen alleen in thema v2 zat, niet in het live thema. Nu v2 zelf
  live staat, gebruiken ze dat sjabloon weer en werkt de uitgebreide opmaak.
- **Lege contactpagina.** De pagina had wel een formulier maar geen tekst. Er
  staat nu een korte uitleg, drie tips voor je schrijft en links naar levering,
  retour en licentie.
- **Lege collectiepagina's.** Drie collecties hadden maar één product. De Complete
  Bundel hoort inhoudelijk in Planners, Budget & geld en AI & productiviteit en
  staat daar nu ook in.
- **Menu's opgeschoond.** Hoofdmenu: Home, Shop (met Alle producten, Planners,
  Budget & geld, AI & productiviteit, Bundels), Blog, Over ons, Contact.
  Footer: Veelgestelde vragen, Levering, Retourbeleid, Licentie en gebruik,
  Algemene voorwaarden, Contact. Geen dubbele of dode links meer.

## Staat live in de winkel

- **5 producten**, allemaal op Actief **én gepubliceerd op het verkoopkanaal
  Webshop**. Ze waren wel actief maar niet gepubliceerd, waardoor ze niet in de
  winkel te zien waren; dat is verholpen. Elk product heeft prijs, van-prijs,
  SKU, beschrijving, tags, SEO-titel en -omschrijving en 5 of 6 afbeeldingen.
- **4 collecties** (Planners, Budget & geld, AI & productiviteit, Bundels) met
  eigen tekstvrije collectiefoto en SEO.
- **1 gratis product** (Gratis Weekplanner + Gewoontetracker, €0,00) met een eigen
  landingspagina `/pages/gratis-weekplanner`, om e-mailadressen mee te verzamelen.
- **Hoofdmenu en footermenu**, 8 pagina's, blog met 16 artikelen (allemaal met
  afbeelding, alt-tekst, tags, SEO-titel en meta-omschrijving), kortingscode
  WELKOM10.
- **Thema "Plannerij v2 (alle templates)"** is het live thema: homepage, header met
  aankondigingsbalk, footer met nieuwsbrief en productpagina.
- **Afbeeldingen zonder ingebakken tekst.** De eerste set mockups had de
  merknaam, producttitel en een badge in de afbeelding staan, terwijl het thema
  daar zijn eigen koppen overheen zet; die woorden stonden dus dubbel. Alle
  hero- en collectiefoto's zijn vervangen door tekstvrije versies onder dezelfde
  bestandsnaam, dus de live pagina's gebruiken ze meteen.

## Marketing staat klaar

- **9 klantsegmenten** (per product, nieuwsbrief-zonder-aankoop, upsell naar de
  bundel, recente kopers) om je e-mails gericht te versturen.
- **12 korte URL's**: `/planner`, `/budget`, `/prompts`, `/printables`, `/bundel`,
  `/gratis`, `/links`, `/shop`, `/blog`, `/faq` en twee varianten.
- **Linkpagina `/pages/links`** voor in je Instagram- en TikTok-bio.
- **30 Pinterest-pins**, **56 Instagram/TikTok-beelden** en **12 mailbanners**,
  met uploadlijsten waarin titel, bord, doel-URL, caption en hashtags al klaar
  staan: `marketing/08`, `09` en `04-email.md` onderdeel F.
- Uitleg van alles wat in Shopify zelf staat: `marketing/12`.
- **Pinterest**: alle 6 producten staan op het verkoopkanaal Pinterest, de 30
  pinafbeeldingen staan in Shopify Files, en `marketing/pinterest-bulk-upload.csv`
  maakt en plant ze in één upload. Uitleg in `marketing/14`.

## Nog te doen (kan niet via de API)

1. ~~**Thema v2 publiceren.**~~ Gedaan: "Plannerij v2 (alle templates)" is het live
   thema. De winkelwagen, het contactformulier, de collectie-, 404- en
   zoekpagina's staan daarmee in het Nederlands.
   Ook de sjablonen staan nu goed: Over Plannerij gebruikt `over-ons` en
   Veelgestelde vragen gebruikt `veelgestelde-vragen`, de uitgebreide opmaak uit
   het thema.
2. ~~**Bestanden koppelen in Digital Products.**~~ Gedaan op 13 september en
   getest met een gratis testbestelling: order #1001 staat op betaald en
   afgehandeld, de download werd automatisch geleverd. De koppeling per product:
   - Digitale Planner 2027 → `Plannerij-Digitale-Planner-2027.zip`
   - Budgetplanner → `Plannerij-Budgetplanner.xlsx`
   - AI Prompt Pack → `Plannerij-AI-Prompt-Pack.zip`
   - Printable Bundel → `Plannerij-Printable-Bundel.zip`
   - Complete Bundel 2027 → `Plannerij-Complete-Bundel-2027.zip`

   **Nog wél te doen:** het nieuwe gratis product *Gratis Weekplanner +
   Gewoontetracker* (€0,00) moet op dezelfde manier gekoppeld worden aan
   `Plannerij-Gratis-Weekplanner-A4.pdf` en `-A5.pdf`. Zonder die koppeling
   krijgt iemand die de gratis download bestelt geen downloadmail — en dat is
   juist de manier waarop je e-mailadressen verzamelt. Stap voor stap uitgelegd
   in `marketing/11-gratis-weggever.md`.
3. **Winkelnaam** – Instellingen → Winkelgegevens → naam "Plannerij", plus
   klantenservice-e-mail en bedrijfsgegevens. De Admin API kent geen mutatie om
   de winkelnaam te wijzigen.
4. **Beleid** – Instellingen → Beleid: plak de teksten uit `winkel/beleid.md` in
   Retourbeleid, Verzendbeleid en Algemene voorwaarden. De app heeft geen
   `write_legal_policies`-recht; dezelfde teksten staan wel al als pagina's in de
   footer.
5. **Betalingen** – Shopify Payments met iDEAL, Bancontact, creditcard, Apple Pay
   en Google Pay, plus PayPal.
6. **Checkout en belasting** – Instellingen → Checkout: verberg het
   verzendadres (digitaal product) en voeg bij de voorwaarden de zin toe: "Ik ga
   akkoord met directe levering en zie af van mijn herroepingsrecht."
   Instellingen → Belastingen: btw 21%, OSS zodra je boven de €10.000 EU-omzet
   komt.
7. **Domein** – plannerij.nl of plannerij.com kopen en koppelen via
   Instellingen → Domeinen.

## Wat alleen jij kunt doen, in volgorde van belang

1. **Betalingen aanzetten** (punt 5). Zonder dit kan niemand iets kopen; al het
   andere hieronder is pas daarna zinvol.
2. **Het gratis product koppelen in Digital Products** (punt 2).
3. **De CSV uploaden bij Pinterest** — borden eerst, zie `marketing/14`.
4. Winkelnaam, beleid, checkout en domein (punten 3, 4, 6, 7).
5. **Posten op Instagram en TikTok** en **e-mails versturen**: beeld en tekst
   liggen klaar in `marketing/09` en `marketing/04-email.md`, maar posten en
   versturen gebeurt in die apps zelf. Daar kan de Shopify-API niet bij.

## Handig om te weten

- QA-rapport van de productbestanden: `winkel/QA-rapport.md`.
- Marketingmateriaal (Pinterest, social, e-mail, 30-dagen plan): `marketing/`.
- Thema-JSON van beide thema's: `winkel/thema/`.
- Alle afbeeldingen: `afbeeldingen/`; opnieuw te genereren met
  `generators/clean_images.py` en `generators/mockups.py`.
