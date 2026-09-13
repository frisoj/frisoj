# Plannerij – digitale producten voor Shopify

Alles wat in deze map staat hoort bij de Shopify-winkel **Plannerij**
(`umaktx-cz.myshopify.com`): een Nederlandse webshop met digitale planners,
een Excel-budgetplanner, een AI-prompt pack en printables.

## Mappen

| Map | Inhoud |
|---|---|
| `producten/` | De verkoopklare bestanden (PDF, XLSX, CSV, TXT) plus zip-bundels per product, en de gratis weekplanner. Dit zijn de bestanden die aan de Shopify Digital Products-producten gekoppeld moeten worden. |
| `afbeeldingen/` | Productmockups (1600×1600), herobanner, logo. Staan ook in Shopify → Content → Files. Submappen: `pinterest/` (30 pins, 1000×1500), `social/` (56 beelden voor Instagram en TikTok), `email/` (12 mailbanners). |
| `generators/` | Python-scripts waarmee alles opnieuw gegenereerd kan worden: producten (`make_planner.py`, `make_printables.py`, `make_budget.py`, `make_prompts_pdf.py`, `make_gratis.py`) en beeldmateriaal (`mockups.py`, `clean_images.py`, `pins.py`, `social.py`, `email_images.py`). Vereist `reportlab`, `openpyxl`, `pillow`, `pymupdf` en de Google-fonts Inter en Playfair Display in `generators/fonts/`. |
| `marketing/` | Het complete marketingmateriaal: positionering, Pinterest, Instagram/TikTok, e-mail, launchplan, advertenties, productteksten, uploadlijsten en de instellingen die in Shopify staan. Begin bij `01-positionering-en-doelgroepen.md`. |
| `winkel/` | Thema-JSON, beleidsteksten, blogartikelen als HTML, QA-rapport en de checklist met wat er nog handmatig moet gebeuren. |

## Producten en prijzen

| Product | Bestand(en) | Prijs |
|---|---|---|
| Digitale Planner 2027 | `Plannerij-Digitale-Planner-2027.zip` (digitale PDF + printbare A4/A5) | €14,95 (van €19,95) |
| Budgetplanner Excel & Google Sheets | `Plannerij-Budgetplanner.xlsx` | €12,95 (van €16,95) |
| AI Prompt Pack (200 prompts) | `Plannerij-AI-Prompt-Pack.zip` (PDF + CSV + TXT) | €9,95 (van €14,95) |
| Printable Bundel | `Plannerij-Printable-Bundel.zip` (A4 + A5) | €7,95 (van €9,95) |
| Complete Bundel 2027 | `Plannerij-Complete-Bundel-2027.zip` (alles) | €29,95 (van €45,80) |

Kortingscode: `WELKOM10` (10%, alle klanten).

## Opnieuw genereren

```bash
pip install reportlab openpyxl pillow pymupdf
cd generators
python3 make_planner.py      # digitale + printbare planner 2027
python3 make_printables.py   # printable bundel A4/A5
python3 make_budget.py       # budgetplanner xlsx
python3 make_prompts_pdf.py  # prompt pack pdf/csv/txt (leest prompts.json)
python3 make_gratis.py       # gratis weekplanner + gewoontetracker (A4/A5)
python3 mockups.py           # productafbeeldingen
python3 pins.py              # 30 Pinterest-pins (1000x1500)
python3 social.py            # Instagram/TikTok: carrousels, covers, stories
python3 email_images.py      # banners voor de e-mailcampagnes
```

De oudere productscripts (`make_planner.py` en de andere `make_*.py` behalve
`make_gratis.py`, plus `mockups.py`) schrijven naar een scratch-map; pas `OUT`/`BASE`
bovenin aan als je ze lokaal draait. De nieuwere scripts bepalen hun paden zelf en
schrijven direct in `afbeeldingen/` en `producten/`.

## Waar staat wat in de winkel

| Onderdeel | Waar |
|---|---|
| Producten, collecties, pagina's, blog | live op `umaktx-cz.myshopify.com` |
| Wat nog handmatig moet (betalingen, winkelnaam, beleid) | `winkel/CHECKLIST.md` |
| Klantsegmenten, korte URL's, linkpagina, UTM's | `marketing/12-marketing-instellingen-shopify.md` |
| Pins uploaden | `marketing/08-pins-uploadlijst.md` |
| Social posten | `marketing/09-social-uploadlijst.md` |
