"""Pinterest-pins voor Plannerij — 30 stuks, 1000x1500 (2:3), PNG.

Bron van waarheid voor titels, teksten en beelden: marketing/02-pinterest.md.
Alle paden worden bepaald op basis van __file__, zodat het script overal draait:

    python3 generators/pins.py            # alle 30 pins
    python3 generators/pins.py 7 12 30    # alleen deze pinnummers

Uitvoer: afbeeldingen/pinterest/pin-01-<slug>.png … pin-30-<slug>.png

Opbouw van elke pin:
  · rustige merkachtergrond (zand #F4EFE6 of salie #5F7A61) met zachte blobs
  · productrender(s) in een eigen "stage" (een transparante laag ter grootte van
    het beeldvlak) zodat een render nooit in het tekstvlak kan lopen
  · een leesbaar tekstvlak: korte kop (Playfair), optionele subregel (Inter)
  · onderaan het merkregeltje "Plannerij"
Geen claims, sterren, reviews of aantallen kopers. Prijzen alleen waar het
marketingplan ze noemt.
"""
import os
import sys
from functools import lru_cache

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mockups  # noqa: E402
from mockups import (DARK, LIGHT, SAGE, SAGE_DARK, SAND, WHITE,  # noqa: E402
                     render_page, shadow_paste, sheet_image, tablet_frame)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # …/shopify/plannerij
PRODUCTEN = os.path.join(ROOT, "producten")
BEELDEN = os.path.join(ROOT, "afbeeldingen")
OUT = os.path.join(BEELDEN, "pinterest")
FONTS = os.path.join(HERE, "fonts")

# mockups.py wijst standaard naar een scratchpad; hier zetten we de fonts goed.
mockups.FONTS = FONTS

PL = os.path.join(PRODUCTEN, "Plannerij-Digitale-Planner-2027.pdf")
PA4 = os.path.join(PRODUCTEN, "Plannerij-Printbare-Planner-2027-A4.pdf")
PB = os.path.join(PRODUCTEN, "Plannerij-Printable-Bundel-A4.pdf")
PR = os.path.join(PRODUCTEN, "Plannerij-AI-Prompt-Pack.pdf")
XLSX = os.path.join(PRODUCTEN, "Plannerij-Budgetplanner.xlsx")

W, H = 1000, 1500
MARGIN = 78
SUBTLE = (112, 120, 113)      # leesbaar grijsgroen op zand
PANEL_SUB = (206, 216, 205)   # subregel op donker vlak

BASIS_URL = "https://umaktx-cz.myshopify.com"


def font(name, size):
    return mockups.font(name, size)


# --------------------------------------------------------------- tekst helpers
def wrap(draw, text, fnt, max_width):
    """Breek tekst af op woordgrenzen; nooit midden in een woord."""
    lines, line = [], ""
    for word in text.split():
        kandidaat = f"{line} {word}".strip()
        if line and draw.textlength(kandidaat, font=fnt) > max_width:
            lines.append(line)
            line = word
        else:
            line = kandidaat
    if line:
        lines.append(line)
    return lines


def fit(draw, text, fontname, max_size, min_size, max_width, max_lines):
    """Zoek de grootste maat waarbij de tekst binnen breedte én regels past."""
    fnt = font(fontname, min_size)
    lines = wrap(draw, text, fnt, max_width)
    for size in range(max_size, min_size - 1, -2):
        f = font(fontname, size)
        ls = wrap(draw, text, f, max_width)
        if len(ls) <= max_lines and max(draw.textlength(l, font=f) for l in ls) <= max_width:
            return f, ls
    return fnt, lines


def block_height(lines, fnt, spacing):
    return int(len(lines) * fnt.size * spacing)


def union(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def draw_lines(draw, lines, fnt, x, y, fill, spacing, center=False, max_width=None, draw_it=True):
    """Teken regels en geef (bbox, y-onder) terug. bbox = werkelijke inktgrenzen."""
    step = fnt.size * spacing
    bbox = None
    for i, line in enumerate(lines):
        if center:
            xy, anchor = (x + (max_width or 0) / 2, y + i * step), "ma"
        else:
            xy, anchor = (x, y + i * step), "la"
        bbox = union(bbox, draw.textbbox(xy, line, font=fnt, anchor=anchor))
        if draw_it:
            draw.text(xy, line, font=fnt, fill=fill, anchor=anchor)
    return bbox, int(y + len(lines) * step)


def text_block(im, kop, sub, box, colors, center=True, draw_it=True):
    """Zet kop (+ subregel) verticaal gecentreerd in box=(x, y, w, h).
    Geeft de bounding boxes terug: {"kop": bbox, "sub": bbox|None}."""
    d = ImageDraw.Draw(im)
    x, y, bw, bh = box
    kop_font, kop_lines = fit(d, kop, "PlayfairDisplay-700", 78, 42, bw, 3)
    kop_h = block_height(kop_lines, kop_font, 1.16)
    sub_h = 0
    sub_font = sub_lines = None
    if sub:
        sub_font, sub_lines = fit(d, sub, "Inter-500", 34, 22, bw, 2)
        sub_h = block_height(sub_lines, sub_font, 1.35) + 18
    top = y + max(0, (bh - (kop_h + sub_h)) // 2)
    kop_box, cur = draw_lines(d, kop_lines, kop_font, x, top, colors[0], 1.16, center, bw, draw_it)
    sub_box = None
    if sub:
        sub_box, cur = draw_lines(d, sub_lines, sub_font, x, cur + 18, colors[1], 1.35,
                                  center, bw, draw_it)
    return {"kop": kop_box, "sub": sub_box, "kop_size": kop_font.size,
            "sub_size": sub_font.size if sub_font else None,
            "kop_regels": kop_lines, "sub_regels": sub_lines}


def brand_line(im, y, color, center_x=W // 2, draw_it=True):
    d = ImageDraw.Draw(im)
    f = font("PlayfairDisplay-600", 34)
    box = d.textbbox((center_x, y), "Plannerij", font=f, anchor="mm")
    tw = d.textlength("Plannerij", font=f)
    if draw_it:
        d.text((center_x, y), "Plannerij", font=f, fill=color, anchor="mm")
        for dx in (-tw / 2 - 34, tw / 2 + 34):
            d.ellipse((center_x + dx - 4, y - 4, center_x + dx + 4, y + 4), fill=color)
    return (box[0] - 42, box[1], box[2] + 42, box[3])


# --------------------------------------------------------------- beeld helpers
@lru_cache(maxsize=None)
def page(pdf, idx, width):
    return render_page(pdf, idx, width)


@lru_cache(maxsize=None)
def sheet(name, width, rows, cols, drop=()):
    """Tabblad als beeld. `drop` laat rijnummers weg (1-gebaseerd), handig voor
    lange ondertitels die in een smalle kolom zouden worden afgekapt."""
    im = sheet_image(XLSX, name, width, rows, cols)
    if not drop:
        return im
    rowpx = (im.height - 40) / (rows + 1)
    houden = [r for r in range(1, rows + 1) if r not in drop]
    uit = Image.new("RGB", (im.width, int(rowpx * len(houden)) + 40), WHITE)
    y = 0
    for r in houden:
        strook = im.crop((0, int((r - 1) * rowpx), im.width, int(r * rowpx)))
        uit.paste(strook, (0, y))
        y += strook.height
    return uit


def fit_box(img, max_w, max_h):
    """Schaal zodat het beeld binnen (max_w, max_h) valt."""
    s = min(max_w / img.width, max_h / img.height)
    if s >= 1:
        return img
    return img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS)


def stage(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def put(st, img, xy, angle=0, radius=18, blur=24, offset=(0, 18), alpha=85):
    shadow_paste(st, img, xy, angle=angle, radius=radius, blur=blur, offset=offset, alpha=alpha)


def cx(img, zone_w, dx=0):
    return (zone_w - img.width) // 2 + dx


def background(bg):
    im = Image.new("RGBA", (W, H), bg + (255,))
    d = ImageDraw.Draw(im)
    tint = (LIGHT if bg == SAND else SAGE_DARK) + (255,)
    d.ellipse((W * 0.42, -H * 0.14, W * 1.35, H * 0.34), fill=tint)
    d.ellipse((-W * 0.42, H * 0.66, W * 0.44, H * 1.20), fill=tint)
    return im


# --------------------------------------------------------------- pin-layouts
# layout "top":    tekst boven (0–470), beeld onder (470–1385), merkregel 1432
# layout "bottom": beeld boven (60–900), effen tekstvlak onder (930–1500)
TOP_ZONE = (0, 470, W, 915)
BOTTOM_ZONE = (0, 60, W, 840)


def compose(spec, draw_text=True):
    """Bouw de pin op. Geeft (afbeelding, info) terug; info bevat de
    tekstgrenzen en het beeldvlak, zodat check_pins.py kan controleren."""
    nummer, slug, kop, sub, bg, layout, maker = spec
    im = background(bg)
    if layout == "top":
        zx, zy, zw, zh = TOP_ZONE
        st = stage(zw, zh)
        maker(st, zw, zh)
        im.alpha_composite(st, (zx, zy))
        kleuren = (DARK, SUBTLE) if bg == SAND else (WHITE, LIGHT)
        tekst = text_block(im, kop, sub, (MARGIN, 86, W - 2 * MARGIN, 330), kleuren,
                           draw_it=draw_text)
        merk = brand_line(im, 1432, SAGE_DARK if bg == SAND else LIGHT, draw_it=draw_text)
        paneel = None
    else:
        zx, zy, zw, zh = BOTTOM_ZONE
        st = stage(zw, zh)
        maker(st, zw, zh)
        im.alpha_composite(st, (zx, zy))
        kleur_paneel = SAGE if bg == SAND else DARK
        ImageDraw.Draw(im).rectangle((0, 930, W, H), fill=kleur_paneel + (255,))
        kleuren = (WHITE, LIGHT if kleur_paneel == SAGE else PANEL_SUB)
        tekst = text_block(im, kop, sub, (MARGIN, 962, W - 2 * MARGIN, 380), kleuren,
                           draw_it=draw_text)
        merk = brand_line(im, 1428, LIGHT, draw_it=draw_text)
        paneel = (0, 930, W, H)
    info = {"nummer": nummer, "slug": slug, "layout": layout,
            "beeldvlak": (zx, zy, zx + zw, zy + zh), "paneel": paneel,
            "merk": merk, **tekst}
    return im, info


def build(spec):
    im, info = compose(spec)
    pad = os.path.join(OUT, f"pin-{info['nummer']:02d}-{info['slug']}.png")
    im.convert("RGB").save(pad, optimize=True)
    print(f"{pad}  {im.size[0]}x{im.size[1]}")
    return pad


# --------------------------------------------------------------- stages
def st_planner_hero(st, w, h):
    jaar = fit_box(page(PL, 2, 470), 470, 400)
    maand = fit_box(page(PL, 4, 520), 520, 440)
    tablet = fit_box(tablet_frame(page(PL, 6, 720), bezel=34, radius=54), 830, 640)
    put(st, jaar, (w - jaar.width - 40, 20), angle=6)
    put(st, maand, (30, 120), angle=-4)
    put(st, tablet, (cx(tablet, w), h - tablet.height - 30), blur=30, alpha=95)


def st_tablet_page(idx):
    def maker(st, w, h):
        tab = fit_box(tablet_frame(page(PL, idx, 880), bezel=38, radius=60), w - 80, h - 120)
        put(st, tab, (cx(tab, w), (h - tab.height) // 2), blur=30, alpha=95)
    return maker


def st_planner_page(idx, angle=0):
    def maker(st, w, h):
        pg = fit_box(page(PL, idx, 880), w - 120, h - 140)
        put(st, pg, (cx(pg, w), (h - pg.height) // 2), angle=angle, radius=16)
    return maker


def st_digitaal_papier(st, w, h):
    p1 = fit_box(page(PA4, 3, 340), 340, 480)
    p2 = fit_box(page(PA4, 5, 340), 340, 480)
    tablet = fit_box(tablet_frame(page(PL, 6, 640), bezel=30, radius=48), 740, 560)
    put(st, p1, (w - p1.width - 70, h - p1.height - 40), angle=6)
    put(st, p2, (60, h - p2.height - 60), angle=-5)
    put(st, tablet, (cx(tablet, w), 20), blur=28, alpha=95)


def st_sheets(specs):
    """specs: twee (naam, rijen, kolommen, weg-te-laten-rijen)-tuples."""
    def maker(st, w, h):
        (n1, r1, c1, d1), (n2, r2, c2, d2) = specs
        a = fit_box(sheet(n1, 900, r1, c1, d1), w - 180, int(h * 0.52))
        b = fit_box(sheet(n2, 900, r2, c2, d2), w - 240, int(h * 0.46))
        put(st, b, (w - b.width - 70, 50), angle=5, radius=14)
        put(st, a, (60, h - a.height - 70), angle=-3, radius=14)
    return maker


def st_sheet(name, rows=32, cols=9, drop=()):
    def maker(st, w, h):
        img = fit_box(sheet(name, 1100, rows, cols, drop), w - 150, h - 90)
        put(st, img, (cx(img, w), (h - img.height) // 2), radius=14)
    return maker


def st_prompts_hero(st, w, h):
    a = fit_box(page(PR, 0, 420), 420, 594)
    b = fit_box(page(PR, 4, 420), 420, 594)
    c = fit_box(page(PR, 22, 420), 420, 594)
    put(st, c, (w - c.width - 40, 30), angle=7)
    put(st, b, (cx(b, w), 150), angle=-4)
    put(st, a, (40, h - a.height - 40), angle=3)


def st_pdf_page(pdf, idx, angle=0, second=None):
    def maker(st, w, h):
        if second is None:
            pg = fit_box(page(pdf, idx, 900), w - 260, h - 120)
            put(st, pg, (cx(pg, w), (h - pg.height) // 2), angle=angle, radius=16)
        else:
            a = fit_box(page(pdf, idx, 520), 460, 650)
            b = fit_box(page(pdf, second, 520), 460, 650)
            put(st, b, (w - b.width - 50, h - b.height - 60), angle=5)
            put(st, a, (50, 40), angle=-4)
    return maker


def st_categorieen(st, w, h):
    """Tien categorieën als rustige kaartjes — zelfde opzet als de mockups."""
    cats = ["Ondernemen & strategie", "Marketing & social media", "Content & copywriting",
            "E-mail & klantcommunicatie", "Productiviteit & planning", "Studie & leren",
            "Carrière & solliciteren", "Geld & financiën", "Persoonlijke groei", "Huishouden & gezin"]
    d = ImageDraw.Draw(st)
    kw, kh, gap = w - 2 * 90, 74, 14
    top = (h - (len(cats) * (kh + gap) - gap)) // 2
    f = font("Inter-600", 27)
    fn = font("Inter-700", 24)
    for i, ct in enumerate(cats):
        y = top + i * (kh + gap)
        d.rounded_rectangle((90, y, 90 + kw, y + kh), radius=20, fill=WHITE + (255,))
        d.ellipse((116, y + 18, 116 + 38, y + 56), fill=LIGHT + (255,))
        d.text((135, y + 37), f"{i + 1:02d}"[-2:], font=fn, fill=SAGE_DARK, anchor="mm")
        d.text((176, y + 37), ct, font=f, fill=DARK, anchor="lm")


def st_printables_hero(st, w, h):
    a = fit_box(page(PB, 1, 400), 400, 566)
    b = fit_box(page(PB, 4, 400), 400, 566)
    c = fit_box(page(PB, 7, 400), 400, 566)
    put(st, c, (w - c.width - 40, 30), angle=7)
    put(st, b, (cx(b, w), 160), angle=-4)
    put(st, a, (40, h - a.height - 40), angle=3)


def st_collage(items):
    """items: lijst van (img-callable, box(x, y, w, h), angle)."""
    def maker(st, w, h):
        for maak, (x, y, bw, bh), angle in items:
            img = fit_box(maak(), bw, bh)
            put(st, img, (x, y), angle=angle, radius=14)
    return maker


def st_bundel_hero(st, w, h):
    maand = fit_box(page(PL, 4, 540), 540, 420)
    jaar = fit_box(sheet("Jaaroverzicht", 760, 24, 8, (3,)), 420, 320)
    pbl = fit_box(page(PB, 1, 290), 290, 410)
    prm = fit_box(page(PR, 4, 290), 290, 410)
    put(st, maand, (70, 60), angle=-5)
    put(st, pbl, (w - pbl.width - 70, 40), angle=7)
    put(st, jaar, (70, h - jaar.height - 80), angle=3, radius=12)
    put(st, prm, (w - prm.width - 110, h - prm.height - 70), angle=-6)


def st_vier_thumbs(st, w, h):
    """Vier kleine thumbnails: planner, budget, prompts, printables."""
    cw = (w - 2 * 80 - 44) // 2
    items = [page(PL, 6, 600), sheet("Jaaroverzicht", 760, 24, 8, (3,)), page(PR, 4, 400), page(PB, 1, 400)]
    ch = min(int(cw * 0.86), (h - 44 - 60) // 2)
    top = (h - (ch * 2 + 44)) // 2
    for i, img in enumerate(items):
        col, row = i % 2, i // 2
        x, y = 80 + col * (cw + 44), top + row * (ch + 44)
        card = Image.new("RGBA", (cw, ch), WHITE + (255,))
        fitted = fit_box(img, cw - 24, ch - 24)
        card.paste(fitted.convert("RGB"), ((cw - fitted.width) // 2, (ch - fitted.height) // 2))
        put(st, card, (x, y), radius=16, blur=18, offset=(0, 12), alpha=70)


# --------------------------------------------------------------- de 30 pins
# (nummer, slug, kop, subregel, achtergrond, layout, stage)
PINS = [
    (1, "digitale-planner-2027", "Digitale planner 2027",
     "Nederlands · voor GoodNotes en Samsung Notes", SAND, "top", st_planner_hero),
    (2, "weekpagina-goodnotes", "Zo ziet een weekpagina eruit",
     "Weeknummers en feestdagen NL/BE", SAGE, "bottom", st_tablet_page(6)),
    (3, "gewoontetracker-maand", "Gewoontetracker per maand",
     "Afvinken op je tablet, geen losse app", SAND, "top", st_planner_page(5)),
    (4, "digitaal-of-papier", "Digitaal of papier?",
     "Zo kies je je planner voor 2027", SAGE, "top", st_digitaal_papier),
    (5, "maandoverzicht-2027", "Maandoverzicht 2027",
     "Met feestdagen Nederland en België", SAND, "bottom", st_planner_page(4)),
    (6, "studieplanner-2027", "Studieplanner 2027",
     "Weeknummers en deadlines op één plek", SAGE, "top", st_planner_page(2)),

    (7, "budgetplanner-excel-sheets", "Budgetplanner Excel & Google Sheets",
     "Nederlands jaaroverzicht en 12 maandtabbladen", SAND, "top",
     st_sheets([("Jaaroverzicht", 30, 9, (3,)), ("Januari", 30, 8, ())])),
    (8, "maandbudget-maken", "Maandbudget maken",
     "Stap voor stap in Excel of Google Sheets", SAGE, "bottom", st_sheet("Januari", 30, 8)),
    (9, "52-weken-spaarchallenge", "52-weken spaarchallenge",
     "Elke week een bedrag, automatisch opgeteld", SAND, "top",
     st_sheet("Spaarpotjes 52 weken", 21, 7, (1, 2, 3))),
    (10, "abonnementenchecker", "Abonnementenchecker",
     "Zie per maand en per jaar wat je betaalt", SAGE, "bottom", st_sheet("Abonnementen", 26, 8, (3,))),
    (11, "jaardashboard-grafiek", "Jaardashboard met grafiek",
     "Inkomsten, uitgaven en sparen in één blik", SAND, "top", st_sheet("Jaaroverzicht", 30, 9, (3,))),
    (12, "budget-wisselend-inkomen", "Voor wisselend inkomen",
     "Budgetplanner voor zzp'ers", SAGE, "top",
     st_sheets([("Jaaroverzicht", 30, 9, (3,)), ("Spaardoelen", 13, 9, (3,))])),

    (13, "200-nederlandse-prompts", "200 Nederlandse prompts",
     "10 categorieën · ChatGPT, Claude en Gemini", SAND, "top", st_prompts_hero),
    (14, "tijd-besparen-prompts", "Tijd besparen met prompts",
     "Nederlandse prompts met voorbeelden", SAGE, "top", st_categorieen),
    (15, "prompts-voor-mails", "Prompts voor je mails",
     "Offerte opvolgen, herinneren, netjes afwijzen", SAND, "bottom",
     st_pdf_page(PR, 23, second=22)),
    (16, "prompts-studenten", "AI-prompts voor studenten",
     "Samenvatten, oefenvragen en planning", SAGE, "top", st_pdf_page(PR, 36, second=35)),
    (17, "taken-kleine-stappen", "Grote taken, kleine stappen",
     "Prompts die je helpen beginnen", SAND, "bottom", st_pdf_page(PR, 30)),
    (18, "pdf-csv-txt", "PDF · CSV · TXT",
     "200 prompts in drie bestandsvormen", SAGE, "top", st_prompts_hero),

    (19, "12-printables-a4-a5", "12 printables · A4 en A5",
     "Weekplanner, gewoontetracker, to-do en meer", SAND, "top", st_printables_hero),
    (20, "weekplanner-printable", "Weekplanner printable A4",
     "Nederlands en ongedateerd", SAGE, "bottom", st_pdf_page(PB, 1)),
    (21, "maaltijdplanner", "Maaltijdplanner voor de koelkast",
     "Weekmenu en boodschappenlijst", SAND, "top", st_pdf_page(PB, 7)),
    (22, "brain-dump", "Alles uit je hoofd op één vel",
     "Brain dump en dagplanner om te printen", SAGE, "top", st_pdf_page(PB, 6, second=3)),
    (23, "schoonmaakschema", "Schoonmaakschema",
     "Per week en per maand afvinken", SAND, "bottom", st_pdf_page(PB, 10)),
    (24, "gewoontetracker-printable", "Gewoontetracker printable",
     "30 dagen afvinken, ongedateerd", SAGE, "top", st_pdf_page(PB, 4)),

    (25, "complete-bundel-2027", "Complete Bundel 2027",
     "Planner, budgetplanner, prompts en printables · €29,95", SAND, "top", st_bundel_hero),
    (26, "agenda-geld-gewoontes", "Agenda · Geld · Gewoontes",
     "Je hele 2027 in één pakket", SAGE, "top", st_bundel_hero),
    (27, "rust-in-je-hoofd", "Rust in je hoofd begint met overzicht",
     "Complete Bundel 2027 · Nederlands", SAND, "bottom", st_bundel_hero),
    (28, "bundel-voor-ouders", "Bundel voor ouders",
     "Weekplanner, maaltijdplanner en budget", SAGE, "top", st_collage([
         (lambda: page(PL, 6, 580), (60, 40, 580, 440), -4),
         (lambda: page(PB, 7, 300), (610, 300, 300, 425), 6),
         (lambda: sheet("Januari", 820, 28, 8), (70, 480, 470, 350), 3),
     ])),
    (29, "bundel-voor-zzp", "Bundel voor zzp'ers",
     "Weekplanner, budget en prompts voor je mails", SAND, "top", st_collage([
         (lambda: page(PL, 4, 580), (60, 40, 580, 440), -4),
         (lambda: page(PR, 23, 300), (610, 300, 300, 425), 6),
         (lambda: sheet("Jaaroverzicht", 820, 26, 8, (3,)), (70, 480, 470, 350), 3),
     ])),
    (30, "dit-zit-erin", "Dit zit erin",
     "Planner · Budgetplanner · Prompts · Printables", SAGE, "top", st_vier_thumbs),
]

# doel-URL's per pin, exact zoals in marketing/02-pinterest.md
URLS = {
    **{n: f"{BASIS_URL}/products/digitale-planner-2027" for n in (1, 2, 3, 5, 6)},
    4: f"{BASIS_URL}/blogs/blog/digitale-planner-of-papieren-planner-2027",
    **{n: f"{BASIS_URL}/products/budgetplanner-excel-google-sheets" for n in (7, 9, 10, 11, 12)},
    8: f"{BASIS_URL}/blogs/blog/maandbudget-maken-excel-google-sheets",
    **{n: f"{BASIS_URL}/products/ai-prompt-pack-nederlands" for n in (13, 15, 16, 17, 18)},
    14: f"{BASIS_URL}/blogs/blog/nederlandse-chatgpt-prompts-tijd-besparen",
    **{n: f"{BASIS_URL}/products/printable-bundel-weekplanner-gewoontetracker"
       for n in (19, 20, 21, 22, 23, 24)},
    **{n: f"{BASIS_URL}/products/complete-bundel-2027" for n in (25, 26, 27, 28, 29, 30)},
}


def main(argv):
    os.makedirs(OUT, exist_ok=True)
    wanted = {int(a) for a in argv} if argv else None
    for spec in PINS:
        if wanted and spec[0] not in wanted:
            continue
        build(spec)


if __name__ == "__main__":
    main(sys.argv[1:])
