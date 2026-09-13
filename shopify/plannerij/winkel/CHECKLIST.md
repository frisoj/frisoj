# Plannerij – status en resterende stappen

Bijgewerkt op 13 september 2026, na de correctieronde.

## Staat live in de winkel

- **5 producten**, allemaal op Actief **én gepubliceerd op het verkoopkanaal
  Webshop**. Ze waren wel actief maar niet gepubliceerd, waardoor ze niet in de
  winkel te zien waren; dat is verholpen. Elk product heeft prijs, van-prijs,
  SKU, beschrijving, tags, SEO-titel en -omschrijving en 5 of 6 afbeeldingen.
- **4 collecties** (Planners, Budget & geld, AI & productiviteit, Bundels) met
  eigen tekstvrije collectiefoto en SEO.
- **Hoofdmenu en footermenu**, 6 pagina's, blog met 7 artikelen (allemaal met
  afbeelding), kortingscode WELKOM10.
- **Thema "Plannerij (Horizon)"** is het live thema: homepage, header met
  aankondigingsbalk, footer met nieuwsbrief en productpagina.
- **Afbeeldingen zonder ingebakken tekst.** De eerste set mockups had de
  merknaam, producttitel en een badge in de afbeelding staan, terwijl het thema
  daar zijn eigen koppen overheen zet; die woorden stonden dus dubbel. Alle
  hero- en collectiefoto's zijn vervangen door tekstvrije versies onder dezelfde
  bestandsnaam, dus de live pagina's gebruiken ze meteen.

## Nog te doen (kan niet via de API)

1. **Thema v2 publiceren.** De kopie "Plannerij v2 (alle templates)" bevat
   bovenop het live thema de Nederlandse templates voor collectie, pagina,
   contact, blog, artikel, 404, zoeken, winkelwagen en wachtwoordpagina, plus de
   opgemaakte Over-ons- en FAQ-pagina. Online Store → Thema's →
   "Plannerij v2 (alle templates)" → Acties → Publiceren. Thema's publiceren is
   in deze omgeving geblokkeerd, dus dit is één klik voor jou.
2. **Bestanden koppelen in Digital Products.** De connector geeft sinds vanmiddag
   "Could not authorize this store with Digital Products", dus de uploadknop
   opent niet meer vanuit de chat. Open Apps → Digital Products en koppel per
   product het bestand uit `producten/`:
   - Digitale Planner 2027 → `Plannerij-Digitale-Planner-2027.zip`
   - Budgetplanner → `Plannerij-Budgetplanner.xlsx`
   - AI Prompt Pack → `Plannerij-AI-Prompt-Pack.zip`
   - Printable Bundel → `Plannerij-Printable-Bundel.zip`
   - Complete Bundel 2027 → `Plannerij-Complete-Bundel-2027.zip`
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

## Handig om te weten

- QA-rapport van de productbestanden: `winkel/QA-rapport.md`.
- Marketingmateriaal (Pinterest, social, e-mail, 30-dagen plan): `marketing/`.
- Thema-JSON van beide thema's: `winkel/thema/`.
- Alle afbeeldingen: `afbeeldingen/`; opnieuw te genereren met
  `generators/clean_images.py` en `generators/mockups.py`.
