# Plannerij – digitale producten voor Shopify

Alles wat in deze map staat hoort bij de Shopify-winkel **Plannerij**
(`umaktx-cz.myshopify.com`): een Nederlandse webshop met digitale planners,
een Excel-budgetplanner, een AI-prompt pack en printables.

## Mappen

| Map | Inhoud |
|---|---|
| `producten/` | De verkoopklare bestanden (PDF, XLSX, CSV, TXT) plus zip-bundels per product. Dit zijn de bestanden die aan de Shopify Digital Products-producten gekoppeld moeten worden. |
| `afbeeldingen/` | Productmockups (1600×1600), herobanner, logo. Staan ook in Shopify → Content → Files. |
| `generators/` | Python-scripts waarmee alle producten opnieuw gegenereerd kunnen worden (`make_planner.py`, `make_printables.py`, `make_budget.py`, `make_prompts_pdf.py`, `mockups.py`). Vereist `reportlab`, `openpyxl`, `pillow`, `pymupdf` en de Google-fonts Inter en Playfair Display in `generators/fonts/`. |
| `winkel/` | Thema-JSON (Horizon-kopie "Plannerij (Horizon)"), beleidsteksten en een checklist. |

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
python3 mockups.py           # productafbeeldingen
```

De scripts schrijven naar een scratch-map; pas `OUT`/`BASE` bovenin aan als je ze lokaal draait.
