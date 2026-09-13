# 12 · Marketinginstellingen in Shopify — Plannerij

Dit is het deel van de marketing dat *in* de winkel staat: klantsegmenten voor je
e-mails, korte URL's voor je bio, de linkpagina en de kortingscode. Alles
hieronder is al aangemaakt; je hoeft het alleen te gebruiken.

---

## 1. Klantsegmenten (Klanten → Segmenten)

Segmenten zijn opgeslagen filters op je klantenlijst. In Shopify Email kies je bij
het versturen een segment in plaats van "alle abonnees", zodat mensen alleen mails
krijgen die over hun eigen product gaan. Ze vullen zich automatisch; je hoeft ze
niet bij te houden.

| Segment | Wie zitten erin | Waarvoor gebruik je het |
|---|---|---|
| Kopers Digitale Planner 2027 | iedereen die de planner kocht | mail C1 uit `04-email.md` (zo zet je hem op je tablet), later de upsell naar de Complete Bundel |
| Kopers Budgetplanner | iedereen die de budgetplanner kocht | mail C2 (zo vul je hem in), tips over sparen |
| Kopers AI Prompt Pack | kopers van het promptpakket | mail C3, nieuwe promptcategorieën |
| Kopers Printable Bundel | kopers van de printables | mail C4, printtips |
| Kopers Complete Bundel 2027 | kopers van de bundel | mail C5; **nooit** een bundelaanbieding sturen, die hebben ze al |
| Nieuwsbrief, nog niets gekocht | ingeschreven, nul bestellingen | de welkomstflow en de nieuwsbrieven D1 en D2 |
| Kopers zonder Complete Bundel (upsell) | kocht minstens één ding, maar niet de bundel | de enige groep waar een bundelaanbieding logisch is |
| Kopers afgelopen 90 dagen | recente klanten | nieuwe producten aankondigen; deze groep reageert het best |
| Opende e-mail, kocht nog niet | leest wel, koopt niet | een andere invalshoek proberen, bijvoorbeeld een blogartikel in plaats van een product |

Deze stonden er al vanaf het begin in (van Shopify zelf) en blijven bruikbaar:
klanten die nog niet kochten, klanten die meer dan eens kochten, verlaten
checkouts laatste 30 dagen, e-mailabonnees, klanten met minstens één bestelling.

**Zo gebruik je ze:** Shopify → Marketing → Campagne maken → Shopify Email →
bij *Aan* klik je op het segment. Verstuur nooit hetzelfde bericht aan iedereen:
de C-mails horen bij één segment, de nieuwsbrieven bij "Nieuwsbrief, nog niets
gekocht" plus "Kopers afgelopen 90 dagen".

---

## 2. Korte URL's (Online Store → Navigatie → URL-omleidingen)

Voor in je bio, in een video, of als je iemand snel iets wilt laten zien. Ze
werken zodra je domein gekoppeld is ook als `plannerij.nl/planner`.

| Korte URL | Gaat naar |
|---|---|
| `/planner` en `/planner2027` | Digitale Planner 2027 |
| `/budget` en `/budgetplanner` | Budgetplanner Excel & Google Sheets |
| `/prompts` | AI Prompt Pack |
| `/printables` | Printable Bundel |
| `/bundel` | Complete Bundel 2027 |
| `/gratis` | de gratis weekplanner |
| `/links` | de linkpagina hieronder |
| `/shop` | alle producten |
| `/blog` | de blog |
| `/faq` | veelgestelde vragen |

De vier omleidingen van `/blogs/nieuws/...` naar `/blogs/blog/...` stonden er al
en houden oude bloglinks werkend.

---

## 3. Linkpagina voor je bio — `/pages/links`

Instagram en TikTok laten maar één link in je profiel toe. Zet daar
`umaktx-cz.myshopify.com/links` neer (straks `plannerij.nl/links`). Op die pagina
staan de gratis weekplanner, alle producten, de kortingscode, de blog en contact
onder elkaar. Je hebt dus geen Linktree of ander extern hulpmiddel nodig, en
bezoekers blijven in je eigen winkel.

Werk de pagina bij zodra er een product bij komt: Online Store → Pagina's → Alle
links van Plannerij.

---

## 4. Kortingscodes

- **WELKOM10** — 10% op de hele bestelling, actief, zonder einddatum. Dit is de
  enige code die overal in de teksten staat.
- **Voor micro-influencers** maak je per persoon een code aan, zoals in
  `05-launch-plan-30-dagen.md` beschreven: Kortingen → Code maken →
  Kortingspercentage → 10% → code `NAAM10`. Zo zie je in Kortingen precies hoeveel
  bestellingen via wie binnenkwamen.
- Maak geen codes met een tijdsdruk die niet echt is. De introductieprijs is de
  introductieprijs; dat werkt op de lange termijn beter dan nep-schaarste.

---

## 5. UTM-labels: weten waar je verkopen vandaan komen

Plak achter een link waar je hem deelt, dan zie je het terug in Shopify →
Analytics → Sessies per verwijzing en in Marketing.

```
?utm_source=pinterest&utm_medium=social&utm_campaign=planner2027
?utm_source=instagram&utm_medium=social&utm_campaign=lancering
?utm_source=tiktok&utm_medium=social&utm_campaign=gratis-weekplanner
?utm_source=nieuwsbrief&utm_medium=email&utm_campaign=welkom1
```

Voorbeeld: `https://umaktx-cz.myshopify.com/products/digitale-planner-2027?utm_source=pinterest&utm_medium=social&utm_campaign=planner2027`

Houd `utm_source` simpel (pinterest, instagram, tiktok, nieuwsbrief) en gebruik
voor `utm_campaign` steeds dezelfde naam binnen één campagne. Korte URL's uit
punt 2 kun je niet van UTM's voorzien; gebruik dan de volledige link.

---

## 6. Wat je zelf nog aanzet (kan niet via de API)

1. **Shopify Email installeren** (Apps → Shopify Email) en je afzendadres
   verifiëren. Daarna kun je de teksten uit `04-email.md` één voor één als
   campagne versturen naar de segmenten hierboven.
2. **Automatiseringen** (Marketing → Automatiseringen): zet "Welkomstmail voor
   nieuwe abonnees" en "Verlaten winkelwagen" aan. De teksten staan klaar in
   `04-email.md`, onderdeel A en B.
3. **Verkoopkanaal Pinterest, Facebook & Instagram, TikTok** (Instellingen →
   Apps en verkoopkanalen) als je je producten daar automatisch wilt tonen. Dat
   kan pas nadat betalingen actief zijn.
4. **Google en Bing**: Online Store → Voorkeuren → je winkel laten indexeren, en
   je winkel aanmelden bij Google Search Console. Doe dit pas als de winkel af is
   en de betalingen werken.

---

## 7. Wekelijkse routine (30 minuten, bijvoorbeeld zondag)

1. Analytics → sessies, toegevoegd aan winkelwagen, bestellingen. Noteer de drie
   getallen in een spreadsheet, één regel per week.
2. Kijk bij Sessies per verwijzing welk kanaal bezoekers bracht en doe daar de
   week erna meer van.
3. Zet 5 nieuwe pins klaar (zie `08-pins-uploadlijst.md`) en plan 3 posts in
   (`09-social-uploadlijst.md`).
4. Stuur één e-mail naar één segment.
5. Kijk of er nieuwe vragen binnenkwamen; als dezelfde vraag twee keer komt, zet
   het antwoord op de pagina Veelgestelde vragen.
