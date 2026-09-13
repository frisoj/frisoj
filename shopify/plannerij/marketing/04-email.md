# 04 · E-mail — Plannerij

Alle mails zijn geschreven voor Shopify Email (of Klaviyo/Mailchimp). Afzender: "Plannerij" met een echt reply-adres. Onderaan elke mail: adres, afmeldlink en "Je ontvangt deze mail omdat je je hebt ingeschreven / iets hebt besteld bij Plannerij."

**Vaste elementen**
- Kleuren: zand-achtergrond (#F4EFE6), tekst donker (#1F2A24), knop salie-groen (#5F7A61) met witte tekst.
- Eén knop per mail, nooit meer dan twee links naast elkaar.
- Geen "laatste kans", geen aftellende timers, geen verzonnen aantallen.
- Vervang `{{voornaam}}` door het Shopify-veld voor voornaam, met "hallo" als fallback wanneer die leeg is.
- Basis-URL: https://umaktx-cz.myshopify.com (later plannerij.nl).

---

## A. Welkomstflow (3 mails, na inschrijving voor de nieuwsbrief)

Trigger: inschrijving via pop-up of footer. Timing: mail 1 direct, mail 2 na 2 dagen, mail 3 na 5 dagen. Stop de flow zodra iemand bestelt (dan volgt de bedankmail).

### Welkom 1 — direct

**Onderwerp:** Welkom bij Plannerij, hier is je 10%
**Preheader:** Kortingscode WELKOM10, en wat je van ons kunt verwachten.

Hallo {{voornaam}},

Fijn dat je er bent. Plannerij maakt Nederlandstalige hulpmiddelen om je week, je geld en je hoofd op orde te krijgen: een digitale planner voor 2027, een budgetplanner voor Excel en Google Sheets, Nederlandse AI-prompts en printbare weekplanners.

Als welkom krijg je 10% korting op je eerste bestelling. Gebruik bij het afrekenen deze code:

**WELKOM10**

De code werkt op alle producten, ook op de Complete Bundel 2027.

Wat je van ons kunt verwachten: af en toe een mail met een praktische tip, en een berichtje als er iets nieuws is. Niet vaker dan nodig.

[Bekijk de winkel] → https://umaktx-cz.myshopify.com

Rust in je hoofd begint met overzicht.

Groet,
Plannerij

---

### Welkom 2 — na 2 dagen

**Onderwerp:** Welk product past bij jou?
**Preheader:** Een korte gids: planner, budget, prompts of printables.

Hallo {{voornaam}},

Vier producten, en ze doen allemaal iets anders. Zo kies je:

**Je wilt je week en je afspraken op orde**
→ Digitale Planner 2027. Gedateerd, Nederlands, weeknummers, feestdagen NL/BE, met hyperlinks tussen alle pagina's. Voor GoodNotes, Notability en Samsung Notes, plus printbare A4/A5-versie. €14,95 (introductieprijs).
https://umaktx-cz.myshopify.com/products/digitale-planner-2027

**Je wilt weten waar je geld blijft**
→ Budgetplanner Excel & Google Sheets. Jaardashboard met grafiek, 12 maandtabbladen, spaardoelen, schulden, abonnementenchecker en 52-weken spaarchallenge. €12,95 (introductieprijs).
https://umaktx-cz.myshopify.com/products/budgetplanner-excel-google-sheets

**Je gebruikt ChatGPT, Claude of Gemini en wilt betere Nederlandse resultaten**
→ AI Prompt Pack. 200 Nederlandse prompts in 10 categorieën, als PDF, CSV en TXT. €9,95 (introductieprijs).
https://umaktx-cz.myshopify.com/products/ai-prompt-pack-nederlands

**Je werkt liever op papier of wilt iets op de koelkast**
→ Printable Bundel. 12 ongedateerde printables in A4 en A5: weekplanner, dagplanner, gewoontetracker, maaltijdplanner, schoonmaakschema en meer. €7,95 (introductieprijs).
https://umaktx-cz.myshopify.com/products/printable-bundel-weekplanner-gewoontetracker

**Je wilt alles**
→ Complete Bundel 2027, €29,95 in plaats van €45,80 los.
https://umaktx-cz.myshopify.com/products/complete-bundel-2027

Je code WELKOM10 geldt nog steeds op je eerste bestelling.

[Naar de winkel] → https://umaktx-cz.myshopify.com

Groet,
Plannerij

---

### Welkom 3 — na 5 dagen

**Onderwerp:** Digitaal of papier? Dat hoef je niet te kiezen
**Preheader:** Een rustig artikel, en een herinnering aan je code.

Hallo {{voornaam}},

De vraag die we het vaakst krijgen: "Moet ik een digitale of een papieren planner nemen?"

We hebben er een artikel over geschreven, zonder voorkeur. Waar digitaal handig is (zoeken, meenemen, niets kwijtraken), waar papier wint (geen afleiding, sneller opschrijven) en hoe je erachter komt wat bij jou past.

[Lees: Digitale planner of papieren planner?] → https://umaktx-cz.myshopify.com/blogs/blog/digitale-planner-of-papieren-planner-2027

Bij de Digitale Planner 2027 zit trouwens een printbare A4/A5-versie, dus je hoeft niet te kiezen.

Je welkomstcode WELKOM10 (10% op je eerste bestelling) werkt nog. Dit is de laatste keer dat we je eraan herinneren; daarna hoor je alleen nog van ons als er iets nuttigs te delen is.

Groet,
Plannerij

---

## B. Verlaten winkelwagen (1 mail, na 4 uur)

Trigger: winkelwagen met producten, niet afgerekend, e-mailadres bekend. Eén mail is genoeg voor digitale producten; een tweede voelt snel opdringerig.

**Onderwerp:** Je winkelwagen staat nog klaar
**Preheader:** Geen haast. Hier is de link als je verder wilt.

Hallo {{voornaam}},

Je had iets in je winkelwagen gelegd bij Plannerij, maar de bestelling is niet afgerond. Dat kan allerlei redenen hebben; misschien twijfel je nog, misschien ging de telefoon.

Dit stond erin:
{{winkelwagen_inhoud}}

Als je verder wilt, staat alles nog klaar:

[Terug naar mijn winkelwagen] → {{winkelwagen_link}}

Een paar dingen die misschien helpen bij het beslissen:
- Je ontvangt de bestanden direct na betaling per mail en op de bedankpagina.
- Het is een eenmalige aankoop, geen abonnement.
- Vragen over of iets werkt op jouw tablet of in jouw versie van Excel? Beantwoord deze mail, we reageren zelf.

Nog geen korting gebruikt? Met WELKOM10 krijg je 10% op je eerste bestelling.

Groet,
Plannerij

---

## C. Bedankt + zo gebruik je het (per productcategorie)

Trigger: bestelling betaald. Stuur de mail die past bij het gekochte product; bij de Complete Bundel stuur je de bundelversie (onderaan). Deze mail komt náást de standaard Shopify-orderbevestiging met downloadlinks; zeg dat ook.

### C1 · Digitale Planner 2027

**Onderwerp:** Bedankt! Zo zet je je planner in GoodNotes, Notability of Samsung Notes
**Preheader:** Downloaden, importeren, en drie tips om te beginnen.

Hallo {{voornaam}},

Bedankt voor je bestelling van de Digitale Planner 2027. De downloadlinks staan in je orderbevestiging (aparte mail) en op de bedankpagina.

**Wat je hebt gedownload**
Je downloadt `Plannerij-Digitale-Planner-2027.zip`. Daarin zit:
- `Plannerij-Digitale-Planner-2027.pdf` — de hyperlinked planner voor je tablet.
- `Plannerij-Printbare-Planner-2027-A4.pdf` en `Plannerij-Printbare-Planner-2027-A5.pdf` — de printbare versie.

**Zo importeer je hem**
- GoodNotes (iPad): open de PDF vanuit Bestanden of Mail, kies "Delen" → "GoodNotes" → "Importeren als nieuw document".
- Notability: open de PDF, kies "Delen" → "Notability".
- Samsung Notes: open de PDF, kies "Delen" → "Samsung Notes" → "Importeren als PDF".
- Andere apps: elke app die PDF-annotatie en links ondersteunt werkt. Zet "links volgen" of "alleen-lezen" aan als tikken op een link niet werkt (in GoodNotes: het pen-icoon uit).

**Drie tips om te beginnen**
1. Begin bij de maandpagina van deze maand, niet bij januari 2027. Vaste afspraken erin, klaar.
2. Kies op de gewoontetracker twee gewoontes. Meer kan later altijd nog.
3. Gebruik de notitiepagina's als brain dump: alles wat rondzingt, eruit.

Feestdagen van Nederland en België staan al ingevuld; weeknummers ook.

Werkt iets niet zoals je verwacht? Beantwoord deze mail. We helpen zelf.

Groet,
Plannerij

---

### C2 · Budgetplanner Excel & Google Sheets

**Onderwerp:** Bedankt! Zo start je met de budgetplanner (Excel of Google Sheets)
**Preheader:** Openen, eerste maand invullen, dashboard bekijken.

Hallo {{voornaam}},

Bedankt voor je bestelling van de Budgetplanner. De downloadlinks staan in je orderbevestiging en op de bedankpagina.

**Wat je hebt gedownload**
- `Plannerij-Budgetplanner.xlsx` — voor Excel (2016 of nieuwer, ook Excel voor Mac).
- Voor Google Sheets gebruik je hetzelfde bestand: ga naar sheets.google.com, kies "Bestand" → "Importeren" → "Uploaden", kies het .xlsx-bestand en daarna "Nieuwe spreadsheet maken". Tabbladen en formules blijven werken.

**Zo begin je**
1. Open het tabblad **Start**: daar staat een korte uitleg en vul je je maandelijkse netto-inkomen en vaste lasten in.
2. Ga naar het tabblad van de huidige maand. Log je uitgaven in het uitgavenlogboek; de totalen en categorieën rekenen zichzelf uit.
3. Vul **Spaardoelen** in met een bedrag en een streefdatum. De voortgang loopt mee.
4. Loop **Abonnementen** één keer helemaal door. Je ziet direct wat je per maand en per jaar betaalt.
5. Kijk op het tabblad **Jaaroverzicht**: de grafiek vult zich zodra er een maand is ingevuld. Vaste bedragen en categorieën pas je aan op **Instellingen**.

**Tips**
- Verwijder geen tabbladen en verplaats geen kolommen; de formules verwijzen ernaar.
- Wil je de 52-weken spaarchallenge doen? Het tabblad **Spaarpotjes 52 weken** staat klaar; vink per week af.
- Meer over het opzetten van een maandbudget lees je hier: https://umaktx-cz.myshopify.com/blogs/blog/maandbudget-maken-excel-google-sheets

Loop je ergens vast? Beantwoord deze mail met een schermafbeelding, dan kijken we mee.

Groet,
Plannerij

---

### C3 · AI Prompt Pack

**Onderwerp:** Bedankt! Zo haal je het meeste uit je 200 prompts
**Preheader:** PDF, CSV of TXT: welke gebruik je waarvoor?

Hallo {{voornaam}},

Bedankt voor je bestelling van het AI Prompt Pack. De downloadlinks staan in je orderbevestiging en op de bedankpagina.

**Wat je hebt gedownload**
Je downloadt `Plannerij-AI-Prompt-Pack.zip`. Daarin zit:
- `Plannerij-AI-Prompt-Pack.pdf` — om te lezen en te bladeren, met per categorie een korte uitleg.
- `Plannerij-AI-Prompt-Pack.csv` — om te importeren in Google Sheets, Excel, Notion of een promptbeheertool.
- `Plannerij-AI-Prompt-Pack.txt` — om snel te zoeken en te kopiëren.

**Zo werkt het**
1. Kies een categorie. De tien zijn: Ondernemen & strategie, Marketing & social media, Content & copywriting, E-mail & klantcommunicatie, Productiviteit & planning, Studie & leren, Carrière & solliciteren, Geld & financiën, Persoonlijke groei & gezondheid, Huishouden & gezin. Elke categorie heeft 20 prompts.
2. Kopieer een prompt en vul de delen tussen [haakjes] in met jouw situatie.
3. Plak hem in ChatGPT, Claude of Gemini. Vraag daarna gerust om een kortere, vriendelijkere of formelere versie; de prompts zijn een startpunt.

**Drie prompts om vandaag mee te beginnen**
- "Herschrijf deze mail korter en vriendelijker, in het Nederlands: [mail]"
- "Knip deze taak op in stappen van maximaal 20 minuten: [taak]"
- "Maak vijf oefenvragen over deze tekst, met antwoorden: [tekst]"

Waarom Nederlandse prompts vaak beter werken dan vertaalde Engelse, lees je hier: https://umaktx-cz.myshopify.com/blogs/blog/nederlandse-chatgpt-prompts-tijd-besparen

Mis je een categorie of een prompt? Beantwoord deze mail; nieuwe ideeën nemen we mee in een volgende versie, die je dan gratis krijgt.

Groet,
Plannerij

---

### C4 · Printable Bundel

**Onderwerp:** Bedankt! Zo print je de bundel (A4 en A5)
**Preheader:** Printinstellingen, papier en welke pagina's je eerst pakt.

Hallo {{voornaam}},

Bedankt voor je bestelling van de Printable Bundel. De downloadlinks staan in je orderbevestiging en op de bedankpagina.

**Wat je hebt gedownload**
Je downloadt `Plannerij-Printable-Bundel.zip`. Daarin zit:
- `Plannerij-Printable-Bundel-A4.pdf` — 12 pagina's op A4.
- `Plannerij-Printable-Bundel-A5.pdf` — dezelfde 12 pagina's op A5 (twee per A4-vel met "2 pagina's per blad", of los op A5-papier).

**Printinstellingen**
- Kies "Ware grootte" of "100%" (niet "Aanpassen aan pagina"), anders verschuiven de marges.
- Zwart-wit printen werkt prima; de lijnen zijn licht genoeg om er overheen te schrijven en donker genoeg om te zien.
- Papier van 100–120 gram voelt prettiger dan standaard 80 gram, maar is niet nodig.

**Welke pagina's eerst**
1. **Weekplanner** — hang hem op of leg hem op je bureau.
2. **Brain dump** — één vel om alles uit je hoofd te halen.
3. **Gewoontetracker** — twee gewoontes, één maand.

De pagina's zijn ongedateerd, dus je print ze zo vaak als je wilt. Persoonlijk gebruik; delen van de bestanden zelf is niet de bedoeling, maar een geprinte weekplanner aan iemand meegeven natuurlijk wel.

Vragen? Beantwoord deze mail.

Groet,
Plannerij

---

### C5 · Complete Bundel 2027 (combinatiemail)

**Onderwerp:** Bedankt! Zo begin je met de Complete Bundel 2027
**Preheader:** Vier producten, één rustige startvolgorde.

Hallo {{voornaam}},

Bedankt voor je bestelling van de Complete Bundel 2027. De downloadlink voor `Plannerij-Complete-Bundel-2027.zip` (alle vier de onderdelen) staat in je orderbevestiging en op de bedankpagina.

Vier producten tegelijk kan veel zijn. Dit is een volgorde die rustig werkt:

**Vandaag:** print de weekplanner en de brain dump uit de Printable Bundel (kies "Ware grootte" bij het printen). Alles uit je hoofd, deze week op papier.

**Deze week:** zet de Digitale Planner 2027 in GoodNotes, Notability of Samsung Notes ("Delen" → kies de app). Vul de maandpagina van deze maand in.

**Dit weekend:** open `Plannerij-Budgetplanner.xlsx` (in Excel, of in Google Sheets via "Bestand" → "Importeren"), vul het tabblad Start in en loop de abonnementenchecker door.

**Als het uitkomt:** blader door de PDF van het AI Prompt Pack en probeer één prompt uit de categorie die je het meest gebruikt.

Per onderdeel hebben we een uitgebreidere uitleg; beantwoord deze mail als je die wilt, dan sturen we hem los toe.

Groet,
Plannerij

---

## D. Nieuwsbrieven

### D1 · Lancering

**Onderwerp:** Plannerij is open
**Preheader:** Nederlandse planners, budgetsheets, prompts en printables. Introductieprijzen.

Hallo {{voornaam}},

Vandaag gaat Plannerij open. We maken Nederlandstalige hulpmiddelen voor overzicht: over je week, je geld en alles wat er in je hoofd rondzingt.

Dit staat er nu in de winkel:

**Digitale Planner 2027** — gedateerd, hyperlinked, weeknummers, feestdagen NL/BE, voor GoodNotes, Notability en Samsung Notes, plus printbare A4/A5-versie. €14,95 i.p.v. €19,95.

**Budgetplanner Excel & Google Sheets** — jaardashboard met grafiek, 12 maandtabbladen, spaardoelen, schulden, abonnementenchecker, 52-weken spaarchallenge. €12,95 i.p.v. €16,95.

**AI Prompt Pack** — 200 Nederlandse prompts voor ChatGPT, Claude en Gemini in 10 categorieën, als PDF, CSV en TXT. €9,95 i.p.v. €14,95.

**Printable Bundel** — 12 ongedateerde printables in A4 en A5: weekplanner, dagplanner, gewoontetracker, to-do, brain dump, maaltijdplanner, doelen, maandbudget, schoonmaakschema, notities. €7,95 i.p.v. €9,95.

**Complete Bundel 2027** — alles samen. €29,95 i.p.v. €45,80.

De doorgestreepte prijzen zijn de gewone prijzen die we later hanteren; de introductieprijs geldt in elk geval deze eerste periode. We noemen bewust geen einddatum die we niet zeker weten.

Met **WELKOM10** krijg je 10% korting op je eerste bestelling.

[Bekijk de winkel] → https://umaktx-cz.myshopify.com

Waarom we dit maken: bijna alle planners en templates die we zelf vonden waren Engelstalig, begonnen de week op zondag of misten weeknummers. We wilden iets dat gewoon klopt voor Nederland en België, en dat rustig oogt.

Vragen, ideeën, of iets dat niet werkt? Beantwoord deze mail. We lezen alles zelf.

Rust in je hoofd begint met overzicht.

Groet,
Plannerij

---

### D2 · "2027 begint in september"

**Onderwerp:** 2027 begint in september
**Preheader:** Waarom nu beginnen met je planner beter werkt dan op 1 januari.

Hallo {{voornaam}},

Een eerlijke bekentenis: elke planner die we ooit op 1 januari begonnen, lag in februari onderin een la. Elke planner die we in het najaar begonnen, haalde de zomer.

Het verschil is niet de planner. Het is het moment.

**In september is er al ritme.** Het schooljaar en studiejaar lopen, werk is weer op gang, de agenda vult zich vanzelf. Een planner die je nú pakt, heeft meteen iets te doen.

**Je leert het systeem rustig kennen.** Tegen de tijd dat 2027 begint, weet je precies welke pagina's je gebruikt en welke niet. Geen goede voornemens nodig.

**Doelen bedenk je beter in het najaar.** Op 31 december is alles groots. In oktober is het gewoon: wat wil ik volgend jaar anders doen?

**Zo kun je nu al starten**
- De Digitale Planner 2027 is gedateerd vanaf januari, maar de printbare versie bevat ongedateerde week- en notitiepagina's die je nu al gebruikt. Zo bouw je de gewoonte op vóór het jaar begint.
- De Printable Bundel is helemaal ongedateerd: print de weekplanner en begin maandag.
- De Budgetplanner kun je vandaag openen; de maandtabbladen zijn niet aan een jaar gebonden.

[Digitale Planner 2027] → https://umaktx-cz.myshopify.com/products/digitale-planner-2027
[Printable Bundel] → https://umaktx-cz.myshopify.com/products/printable-bundel-weekplanner-gewoontetracker
[Complete Bundel 2027] → https://umaktx-cz.myshopify.com/products/complete-bundel-2027

Nog geen eerste bestelling gedaan? WELKOM10 geeft 10% korting.

Wanneer begon jouw beste planner-jaar? Beantwoord gerust; we zijn benieuwd.

Groet,
Plannerij

---

## E. Praktische instellingen in Shopify Email
- Welkomstflow: Shopify Email → Automatiseringen → "Welkom nieuwe abonnees"; voeg mail 2 en 3 toe met wachttijden van 2 en 3 dagen; voorwaarde "heeft nog niet besteld".
- Verlaten winkelwagen: Automatiseringen → "Verlaten winkelwagen herstellen"; wachttijd 4 uur; één mail.
- Bedankmails per product: Automatiseringen → "Bedankt na aankoop" met conditie op producttitel (of tag "planner", "budget", "prompts", "printables", "bundel").
- Nieuwsbrieven: handmatig versturen; D1 op de lanceringsdag, D2 rond half september of zodra er minstens 50 abonnees zijn (anders liever eerst verder bouwen).

---

## F. Banners voor elke mail

De afbeeldingen staan klaar in `afbeeldingen/email/`. In Shopify Email voeg je ze
toe met het blok **Afbeelding** bovenaan de mail (Uploaden → bestand kiezen). Ze
zijn 1200 px breed gerenderd, dus ze blijven scherp op een telefoon.

| Mail | Bestand |
|---|---|
| Welkom 1 | `mail-welkom-1.png` |
| Welkom 2 | `mail-welkom-2.png` |
| Welkom 3 | `mail-welkom-3.png` |
| Verlaten winkelwagen | `mail-verlaten-winkelwagen.png` |
| Nieuwsbrief D1 · Lancering | `mail-lancering.png` |
| Nieuwsbrief D2 · "2027 begint eerder" | `mail-2027.png` |
| Mail over de gratis weekplanner | `mail-gratis-weekplanner.png` |
| C1 · Digitale Planner 2027 | `mail-product-planner.png` |
| C2 · Budgetplanner | `mail-product-budget.png` |
| C3 · AI Prompt Pack | `mail-product-prompts.png` |
| C4 · Printable Bundel | `mail-product-printables.png` |
| C5 · Complete Bundel 2027 | `mail-product-bundel.png` |

Opnieuw maken of aanpassen: `python3 generators/email_images.py`.

**Alt-tekst niet vergeten.** Shopify Email vraagt erom en sommige mailprogramma's
laden afbeeldingen niet. Houd het simpel, bijvoorbeeld: "Tablet met de weekpagina
van de Digitale Planner 2027 naast een geprinte maandpagina."
