# Plannerij – launch-checklist (handmatige stappen in Shopify admin)

Wat al via de API is ingericht: 5 digitale producten (concept, met prijs,
beschrijving, afbeeldingen en SEO), 4 collecties, hoofd- en footermenu,
6 pagina's (Over ons en FAQ met eigen opgemaakte template), blog met artikelen,
kortingscode WELKOM10, thema-kopie "Plannerij (Horizon)" met homepage, collectie-,
product-, contact-, blog-, artikel-, 404-, zoek-, winkelwagen- en wachtwoordtemplate, en
25 afbeeldingen in Content → Files. QA-rapport: `winkel/QA-rapport.md`.
Marketingmateriaal: `marketing/`.

## Nog te doen (kan niet via de API)

1. **Bestanden koppelen in Digital Products** – open per product de
   Digital Products-app (Apps → Digital Products) en upload het bestand uit
   `producten/`:
   - Digitale Planner 2027 → `Plannerij-Digitale-Planner-2027.zip`
   - Budgetplanner → `Plannerij-Budgetplanner.xlsx`
   - AI Prompt Pack → `Plannerij-AI-Prompt-Pack.zip`
   - Printable Bundel → `Plannerij-Printable-Bundel.zip`
   - Complete Bundel 2027 → `Plannerij-Complete-Bundel-2027.zip`
2. **Producten op Actief zetten** (Producten → selecteer alle 5 → Status: actief)
   en controleren dat ze op het verkoopkanaal Webshop staan.
3. **Winkelnaam** – Instellingen → Winkelgegevens → naam "Plannerij"
   (de API kan de naam niet wijzigen). Zet daar ook het e-mailadres voor
   klanten en (verplicht in de EU) je bedrijfsgegevens.
4. **Thema publiceren** – Online Store → Thema's → "Plannerij (Horizon)" →
   Acties → Publiceren. Controleer eerst in de editor het logo en de
   homepage-secties.
5. **Beleid** – Instellingen → Beleid: plak de teksten uit
   `winkel/beleid.md` in Retourbeleid, Verzendbeleid en Algemene voorwaarden
   (de app heeft geen schrijfrechten op beleidsteksten; ze staan wel al als
   pagina's in de footer).
6. **Checkout** – Instellingen → Checkout: zet "Adres" op "Alleen
   factuuradres" of verberg het verzendadres (digitaal product) en voeg bij
   de voorwaarden-checkbox de zin toe: "Ik ga akkoord met directe levering en
   zie af van mijn herroepingsrecht." Instellingen → Verzending: zorg dat de
   producten geen verzending vereisen (Digital Products doet dit meestal
   automatisch; controleer bij het product "Dit is een fysiek product" = uit).
7. **Betalingen** – Instellingen → Betalingen: Shopify Payments activeren
   met iDEAL, Bancontact, creditcard, Apple Pay/Google Pay en PayPal.
8. **Belasting** – Instellingen → Belastingen: btw 21% (digitale diensten
   worden belast in het land van de klant binnen de EU; boven de
   €10.000-drempel geldt de OSS-regeling).
9. **Domein** – plannerij.nl en plannerij.com zijn beschikbaar (op 13-09-2026).
   Koop er één en koppel hem via Instellingen → Domeinen.
10. **Google Search Console** en **Shopify Analytics** koppelen; sitemap
    staat automatisch op `/sitemap.xml`.
11. **Marketing** – de eerste 30 dagen: Pinterest-pins per product (mockups
    staan in `afbeeldingen/`), 2 Instagram-posts per week, blogartikelen
    delen, en de bundel als hoofdaanbod pushen.
