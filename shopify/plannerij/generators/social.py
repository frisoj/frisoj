"""Social media beelden voor Plannerij (Instagram / TikTok).

Genereert naar ../afbeeldingen/social/:
  * carrousel-<post>-slide-<n>.png   1080x1080  (posts 2, 7, 12, 16, 20)
  * cover-<post>-<slug>.png          1080x1920  (reelcovers, 11 reels)
  * story-<slug>.png                 1080x1920  (4 losse story-templates)
  * feed-<post>-<slug>.png           1080x1080  (posts 4, 9, 14, 18)
  * profiel-avatar.png               320x320
  * highlight-<slug>.png             1080x1920  (5 highlight covers)

Alle teksten komen uit ../marketing/03-instagram-tiktok.md; er worden geen
nieuwe claims verzonnen.

Typografie: Playfair Display voor koppen, Inter voor tekst. Elke tekst wordt
gemeten met textbbox en automatisch verkleind tot hij binnen zijn kader past;
niets loopt over elkaar of buiten de veilige marge. Bij 1080x1920 blijft
minimaal 250 px bovenaan en 350 px onderaan vrij (Instagram/TikTok UI).

Draaien:  python3 social.py            (alles)
          python3 social.py carrousel  (alleen die categorie)
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FONTS_DIR = HERE / "fonts"
IMG = ROOT / "afbeeldingen"
PROD = ROOT / "producten"
OUT = IMG / "social"
OUT.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(HERE))
import mockups  # noqa: E402  (helpers hergebruiken)

mockups.FONTS = str(FONTS_DIR)  # fonts uit deze repo, niet uit een scratchpad
from mockups import render_page, shadow_paste, tablet_frame, sheet_image  # noqa: E402

# ---------------------------------------------------------------- merkkleuren
SAND = (244, 239, 230)
SAGE = (95, 122, 97)
SAGE_DARK = (70, 92, 72)
LIGHT = (232, 239, 230)
DARK = (31, 42, 36)
GREY = (122, 129, 123)
WHITE = (255, 255, 255)

PLANNER_PDF = PROD / "Plannerij-Digitale-Planner-2027.pdf"
PRINTBAAR_PDF = PROD / "Plannerij-Printbare-Planner-2027-A4.pdf"
BUNDEL_PDF = PROD / "Plannerij-Printable-Bundel-A4.pdf"
PROMPTS_PDF = PROD / "Plannerij-AI-Prompt-Pack.pdf"
BUDGET_XLSX = PROD / "Plannerij-Budgetplanner.xlsx"

_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    key = (name, size)
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(str(FONTS_DIR / f"{name}.ttf"), size)
    return _FONT_CACHE[key]


HEAD = "PlayfairDisplay-700"
HEAD_M = "PlayfairDisplay-600"
BODY = "Inter-400"
BODY_M = "Inter-500"
BODY_B = "Inter-600"


# ---------------------------------------------------------------- tekst-layout
def wrap_lines(d: ImageDraw.ImageDraw, text: str, f, max_w: float) -> list[str]:
    """Woordwrap op gemeten breedte; breekt zo nodig ook binnen een lang woord."""
    rough: list[str] = []
    for para in text.split("\n"):
        words = para.split()
        if not words:
            rough.append("")
            continue
        cur = words[0]
        for w in words[1:]:
            probe = f"{cur} {w}"
            if d.textlength(probe, font=f) <= max_w:
                cur = probe
            else:
                rough.append(cur)
                cur = w
        rough.append(cur)
    out: list[str] = []
    for line in rough:
        while line and d.textlength(line, font=f) > max_w and len(line) > 1:
            k = len(line)
            while k > 1 and d.textlength(line[:k], font=f) > max_w:
                k -= 1
            out.append(line[:k].rstrip())
            line = line[k:].lstrip()
        out.append(line)
    return out


_TOFU_CACHE: dict[int, bytes] = {}


def _glyph_bytes(f, ch: str) -> bytes:
    m = f.getmask(ch, mode="L")
    if not m.size[0] or not m.size[1]:
        return b"leeg"
    return bytes(Image.frombytes("L", m.size, bytes(m)).tobytes())


def missing_glyphs(f, txt: str) -> str:
    """Tekens die dit font niet heeft (zouden als blokje renderen)."""
    key = id(f)
    if key not in _TOFU_CACHE:
        _TOFU_CACHE[key] = _glyph_bytes(f, "￿")
    tofu = _TOFU_CACHE[key]
    bad = []
    for ch in set(txt):
        if ch.isspace():
            continue
        if _glyph_bytes(f, ch) == tofu:
            bad.append(ch)
    return "".join(sorted(bad))


def block_extent(d: ImageDraw.ImageDraw, lines: list[str], f, lh: int) -> tuple[float, float]:
    """Werkelijke boven- en onderkant van het tekstblok (regel i op y = i*lh)."""
    tops, bots = [], []
    for i, line in enumerate(lines):
        if not line:
            continue
        bb = d.textbbox((0, i * lh), line, font=f)
        tops.append(bb[1])
        bots.append(bb[3])
    if not tops:
        return 0.0, 0.0
    return min(tops), max(bots)


class Sheet:
    """Canvas met veilige marges; elke plaatsing wordt gecontroleerd."""

    def __init__(self, w, h, bg=SAND, blobs=True, margin=90, safe_top=None, safe_bottom=None,
                 blob_tint=LIGHT, name="?"):
        self.w, self.h = w, h
        self.name = name
        self.margin = margin
        self.safe_top = margin if safe_top is None else safe_top
        self.safe_bottom = (h - margin) if safe_bottom is None else safe_bottom
        self.im = Image.new("RGBA", (w, h), bg + (255,))
        self.d = ImageDraw.Draw(self.im)
        if blobs:
            self.d.ellipse((w * 0.52, -h * 0.22, w * 1.30, h * 0.34), fill=blob_tint + (255,))
            self.d.ellipse((-w * 0.26, h * 0.74, w * 0.34, h * 1.30), fill=blob_tint + (255,))

    # -- controle -----------------------------------------------------------
    def guard(self, box, what):
        x0, y0, x1, y1 = box
        problems = []
        if x0 < self.margin - 0.5:
            problems.append(f"links {x0:.0f} < {self.margin}")
        if x1 > self.w - self.margin + 0.5:
            problems.append(f"rechts {x1:.0f} > {self.w - self.margin}")
        if y0 < self.safe_top - 0.5:
            problems.append(f"boven {y0:.0f} < {self.safe_top}")
        if y1 > self.safe_bottom + 0.5:
            problems.append(f"onder {y1:.0f} > {self.safe_bottom}")
        if problems:
            raise ValueError(f"{self.name}: '{what}' valt buiten de veilige zone: {', '.join(problems)}")

    # -- tekst --------------------------------------------------------------
    def text(self, txt, box, fname, smax, smin, fill=DARK, align="left", valign="top",
             ratio=1.26, what=None):
        """Zet tekst in het kader; verkleint tot alles past. Geeft (top, bottom) terug."""
        what = what or txt[:34]
        self.guard(box, what)
        x0, y0, x1, y1 = box
        bw, bh = x1 - x0, y1 - y0
        chosen = None
        size = smax
        while size >= smin:
            f = font(fname, size)
            lines = wrap_lines(self.d, txt, f, bw)
            lh = int(round(size * ratio))
            top, bot = block_extent(self.d, lines, f, lh)
            height = bot - top
            widest = max((self.d.textlength(ln, font=f) for ln in lines), default=0)
            if height <= bh and widest <= bw:
                chosen = (f, lines, lh, top, height)
                break
            size -= 2
        if chosen is None:
            raise ValueError(f"{self.name}: '{what}' past niet in kader {box} "
                             f"(zelfs niet op {smin}px)")
        f, lines, lh, top, height = chosen
        bad = missing_glyphs(f, txt)
        if bad:
            raise ValueError(f"{self.name}: '{what}' gebruikt tekens die {fname} niet heeft: {bad}")
        if valign == "center":
            oy = y0 - top + (bh - height) / 2
        elif valign == "bottom":
            oy = y0 - top + (bh - height)
        else:
            oy = y0 - top
        for i, line in enumerate(lines):
            if not line:
                continue
            lw = self.d.textlength(line, font=f)
            if align == "center":
                x = x0 + (bw - lw) / 2
            elif align == "right":
                x = x1 - lw
            else:
                x = x0
            self.d.text((x, oy + i * lh), line, font=f, fill=fill)
        return oy + top, oy + top + height

    # -- elementen ----------------------------------------------------------
    def pill(self, cx_or_x, y, label="Plannerij", size=30, center=False, fill=SAGE, fg=WHITE):
        f = font(HEAD_M, size)
        tw = self.d.textlength(label, font=f)
        w = tw + size * 2.2
        h = size * 1.9
        x = (cx_or_x - w / 2) if center else cx_or_x
        self.guard((x, y, x + w, y + h), f"pill {label}")
        self.d.rounded_rectangle((x, y, x + w, y + h), radius=h / 2, fill=fill)
        self.d.text((x + w / 2, y + h / 2), label, font=f, fill=fg, anchor="mm")
        return y + h

    def counter(self, i, total, y=None):
        y = self.safe_top if y is None else y
        f = font(BODY_B, 30)
        txt = f"{i}/{total}"
        tw = self.d.textlength(txt, font=f)
        box = (self.w - self.margin - tw, y + 6, self.w - self.margin, y + 6 + 36)
        self.guard(box, "teller")
        self.d.text((self.w - self.margin, y + 6), txt, font=f, fill=GREY, anchor="ra")

    def rule(self, y, x0=None, x1=None, width=4, fill=SAGE):
        x0 = self.margin if x0 is None else x0
        x1 = (self.w - self.margin) if x1 is None else x1
        self.guard((x0, y, x1, y + width), "lijn")
        self.d.rounded_rectangle((x0, y, x1, y + width), radius=width / 2, fill=fill)

    def swipe(self, x, y, size=36, fill=SAGE, label="Swipe"):
        """'Swipe' met een getekende pijl (de fonts hebben geen pijl-glyph)."""
        f = font(BODY_B, size)
        tw = self.d.textlength(label, font=f)
        self.text(label, (x, y, x + tw + 4, y + size * 1.4), BODY_B, size, size, fill=fill,
                  what="swipe")
        ax = x + tw + size * 0.6
        cy = y + size * 0.72
        a = size * 1.15
        w = max(3, int(size * 0.11))
        self.guard((ax, cy - a * 0.32, ax + a, cy + a * 0.32), "swipe-pijl")
        self.d.line((ax, cy, ax + a, cy), fill=fill, width=w)
        self.d.line((ax + a * 0.62, cy - a * 0.30, ax + a, cy), fill=fill, width=w)
        self.d.line((ax + a * 0.62, cy + a * 0.30, ax + a, cy), fill=fill, width=w)

    def number_badge(self, x, y, n, d=104, fill=SAGE, fg=WHITE):
        self.guard((x, y, x + d, y + d), f"nummer {n}")
        self.d.ellipse((x, y, x + d, y + d), fill=fill)
        self.d.text((x + d / 2, y + d / 2 + 2), str(n), font=font(HEAD, int(d * 0.5)), fill=fg, anchor="mm")
        return y + d

    def card(self, img, box, radius=22, angle=0, shrink=1.0, what="beeld", blur=26, alpha=80):
        """Plaats een afbeelding passend in het kader (aspect behouden, gecentreerd)."""
        self.guard(box, what)
        x0, y0, x1, y1 = box
        bw, bh = (x1 - x0) * shrink, (y1 - y0) * shrink
        if angle:
            bw *= 0.88
            bh *= 0.88
        sc = min(bw / img.width, bh / img.height)
        nw, nh = max(1, int(img.width * sc)), max(1, int(img.height * sc))
        small = img.resize((nw, nh), Image.LANCZOS)
        px = int(x0 + ((x1 - x0) - nw) / 2)
        py = int(y0 + ((y1 - y0) - nh) / 2)
        shadow_paste(self.im, small, (px, py), angle=angle, radius=radius, blur=blur,
                     offset=(0, 18), alpha=alpha)
        return px, py, px + nw, py + nh

    def panel(self, box, radius=32, fill=WHITE, outline=None, width=3, what="paneel"):
        self.guard(box, what)
        self.d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

    def save(self, name):
        path = OUT / name
        self.im.convert("RGB").save(path, optimize=True)
        print(f"  {name}  {self.w}x{self.h}")
        return path


# ---------------------------------------------------------------- productbeeld
_ASSET_CACHE: dict[str, Image.Image] = {}


def asset(key: str) -> Image.Image:
    if key in _ASSET_CACHE:
        return _ASSET_CACHE[key]
    if key == "planner-week":
        im = render_page(PLANNER_PDF, 6, 1200)
    elif key == "planner-maand":
        im = render_page(PLANNER_PDF, 4, 1200)
    elif key == "planner-jaar":
        im = render_page(PLANNER_PDF, 2, 1200)
    elif key == "planner-gewoontes":
        im = render_page(PLANNER_PDF, 5, 1200)
    elif key == "tablet-week":
        im = tablet_frame(render_page(PLANNER_PDF, 6, 1100), bezel=34, radius=54)
    elif key == "tablet-maand":
        im = tablet_frame(render_page(PLANNER_PDF, 4, 1100), bezel=34, radius=54)
    elif key == "tablet-gewoontes":
        im = tablet_frame(render_page(PLANNER_PDF, 5, 1100), bezel=34, radius=54)
    elif key == "printbaar-a4":
        im = render_page(PRINTBAAR_PDF, 5, 900)
    elif key == "printable-week":
        im = render_page(BUNDEL_PDF, 1, 900)
    elif key == "printable-dag":
        im = render_page(BUNDEL_PDF, 3, 900)
    elif key == "printable-gewoonte":
        im = render_page(BUNDEL_PDF, 4, 900)
    elif key == "printable-maaltijd":
        im = render_page(BUNDEL_PDF, 7, 900)
    elif key == "prompts-kaart":
        im = render_page(PROMPTS_PDF, 5, 900)
    elif key == "prompts-categorie":
        im = render_page(PROMPTS_PDF, 12, 900)
    elif key == "prompts-uitleg":
        im = render_page(PROMPTS_PDF, 1, 900)
    elif key == "budget-jaar":
        im = sheet_image(str(BUDGET_XLSX), "Jaaroverzicht", 1200, 30, 9)
    elif key == "budget-januari":
        im = sheet_image(str(BUDGET_XLSX), "Januari", 1200, 30, 9)
    elif key == "budget-abonnementen":
        im = sheet_image(str(BUDGET_XLSX), "Abonnementen", 1200, 26, 8)
    elif key == "budget-spaarpotjes":
        im = sheet_image(str(BUDGET_XLSX), "Spaarpotjes 52 weken", 1100, 30, 7)
    elif key == "budget-spaardoelen":
        im = sheet_image(str(BUDGET_XLSX), "Spaardoelen", 1100, 26, 8)
    else:  # bestaande merkbeelden
        im = Image.open(IMG / f"{key}.png").convert("RGB")
    _ASSET_CACHE[key] = im
    return im


def _paste(dst, src, xy):
    dst.paste(src, xy, src if src.mode == "RGBA" else None)


def duo(left_key: str, right_key: str, gap: int = 40) -> Image.Image:
    """Twee beelden naast elkaar op één kaart (zelfde hoogte)."""
    a, b = asset(left_key), asset(right_key)
    h = 900
    a2 = a.resize((int(a.width * h / a.height), h), Image.LANCZOS)
    b2 = b.resize((int(b.width * h / b.height), h), Image.LANCZOS)
    im = Image.new("RGB", (a2.width + gap + b2.width, h), SAND)
    _paste(im, a2, (0, 0))
    _paste(im, b2, (a2.width + gap, 0))
    return im


def quad(keys=("tablet-week", "budget-jaar", "prompts-kaart", "printable-week"),
         cell: int = 620, gap: int = 40) -> Image.Image:
    """Vier producten in een 2x2 raster (voor de Complete Bundel)."""
    im = Image.new("RGB", (cell * 2 + gap, cell * 2 + gap), SAND)
    for i, k in enumerate(keys):
        a = asset(k)
        sc = min(cell / a.width, cell / a.height)
        b = a.resize((max(1, int(a.width * sc)), max(1, int(a.height * sc))), Image.LANCZOS)
        x = (i % 2) * (cell + gap) + (cell - b.width) // 2
        y = (i // 2) * (cell + gap) + (cell - b.height) // 2
        _paste(im, b, (x, y))
    return im


def picture(key):
    """Beeld op naam; 'quad' bouwt de bundelcompositie."""
    return quad() if key == "quad" else asset(key)


# ================================================================= carrousels
SQ = 1080
CAROUSELS = {
    2: {
        "hook": "5 dingen die in een Nederlandse planner horen (en in de meeste ontbreken).",
        "kicker": "Digitale Planner 2027",
        "points": [
            ("Weekstart op maandag.", ""),
            ("Weeknummers.", ""),
            ("Feestdagen NL én BE.", ""),
            ("Genoeg witruimte.", ""),
            ("Een plek voor losse gedachten.", ""),
        ],
        "cta": ("Dit zit allemaal in de Digitale Planner 2027.", "Link in bio · WELKOM10 voor 10% korting"),
        "cta_img": "planner-maand",
    },
    7: {
        "hook": "Maandbudget maken in 4 stappen.",
        "kicker": "Budgetplanner",
        "points": [
            ("Schrijf je netto-inkomen op.", ""),
            ("Zet je vaste lasten eronder.", "Huur, energie, verzekeringen, abonnementen."),
            ("Kies een bedrag voor sparen en zet dat apart vóór je de rest uitgeeft.", ""),
            ("Wat overblijft is je maandbudget voor boodschappen en de rest.", "Log je uitgaven."),
        ],
        "cta": ("Hulp nodig? Volledige uitleg op het blog.", "Link in bio"),
        "cta_img": "budget-januari",
    },
    12: {
        "hook": "Onze keukenmuur: drie printables en verder niets.",
        "kicker": "Printable Bundel",
        "points": [
            ("Weekplanner.", "Wie is waar, wanneer."),
            ("Maaltijdplanner.", "Zes avonden ingevuld, één vrij."),
            ("Schoonmaakschema.", "Wat er deze week echt moet."),
        ],
        "cta": ("Elke zondag 10 minuten.", "Printable Bundel · link in bio"),
        "cta_img": "printable-maaltijd",
    },
    16: {
        "hook": "Waarom 2027 plannen nu al slim is (ook al is het pas september).",
        "kicker": "Digitale Planner 2027",
        "points": [
            ("Studiejaar en schooljaar lopen al.", ""),
            ("Je leert de planner rustig kennen vóór januari.", ""),
            ("Doelen voor 2027 bedenk je beter in het najaar dan op 31 december.", ""),
            ("De printbare versie gebruik je nu al voor losse weken.", ""),
        ],
        "cta": ("Digitale Planner 2027.", "Introductieprijs · link in bio"),
        "cta_img": "tablet-week",
    },
}

POST20 = {
    "hook": "Vier weken Plannerij: dit hebben we gedeeld.",
    "kicker": "Wat er in de winkel staat",
    "products": [
        ("Digitale Planner 2027", "GoodNotes · Notability · Samsung Notes · €14,95", "tablet-week"),
        ("Budgetplanner", "Excel en Google Sheets · €12,95", "budget-jaar"),
        ("AI Prompt Pack", "200 Nederlandse prompts · €9,95", "prompts-kaart"),
        ("Printable Bundel", "12 printables, A4 en A5 · €7,95", "printable-week"),
        ("Complete Bundel 2027", "Alles samen · €29,95 i.p.v. €45,80", "quad"),
    ],
    "cta": ("Vragen? Stuur een DM.", "WELKOM10 · link in bio"),
}


def slide(name, total, index):
    s = Sheet(SQ, SQ, blobs=(index in (1, total)), name=name)
    s.counter(index, total, y=92)
    return s


def carousel(post: int, spec: dict):
    total = 2 + len(spec["points"])
    n = 1
    # slide 1 — hook
    s = slide(f"carrousel-{post}-slide-1", total, 1)
    s.pill(90, 90)
    s.text(spec["hook"], (90, 300, 990, 740), HEAD, 96, 40, fill=DARK, valign="center",
           what="hook")
    s.rule(820, x1=300)
    s.swipe(90, 868)
    s.save(f"carrousel-{post}-slide-1.png")
    # punten
    for i, (title, sub) in enumerate(spec["points"], start=1):
        n = i + 1
        s = slide(f"carrousel-{post}-slide-{n}", total, n)
        s.number_badge(90, 90, i)
        has_sub = bool(sub)
        title_box = (90, 270, 990, 620 if has_sub else 730)
        s.text(title, title_box, HEAD, 88, 38, fill=DARK, valign="center", what=f"punt {i}")
        if has_sub:
            s.text(sub, (90, 660, 990, 820), BODY, 42, 26, fill=GREY, what=f"sub {i}")
        s.text(spec["kicker"], (90, 920, 990, 970), BODY_M, 30, 22, fill=SAGE, what="kicker")
        s.save(f"carrousel-{post}-slide-{n}.png")
    # laatste slide — call to action met productbeeld
    n = total
    s = slide(f"carrousel-{post}-slide-{n}", total, n)
    s.card(picture(spec["cta_img"]), (120, 170, 960, 600), what="productbeeld")
    s.text(spec["cta"][0], (90, 650, 990, 810), HEAD, 62, 32, fill=DARK, valign="center", what="cta")
    s.text(spec["cta"][1], (90, 840, 990, 930), BODY_M, 38, 24, fill=SAGE, what="cta-sub")
    s.save(f"carrousel-{post}-slide-{n}.png")


def carousel_20():
    spec = POST20
    total = 2 + len(spec["products"])
    s = slide("carrousel-20-slide-1", total, 1)
    s.pill(90, 90)
    s.text(spec["hook"], (90, 300, 990, 740), HEAD, 96, 40, valign="center", what="hook")
    s.rule(820, x1=300)
    s.swipe(90, 868)
    s.save("carrousel-20-slide-1.png")
    for i, (title, sub, key) in enumerate(spec["products"], start=1):
        n = i + 1
        s = slide(f"carrousel-20-slide-{n}", total, n)
        s.text(title, (90, 150, 900, 250), HEAD, 60, 32, valign="center", what="titel")
        s.text(sub, (90, 265, 990, 335), BODY_M, 34, 22, fill=SAGE, what="sub")
        s.card(picture(key), (110, 370, 970, 960), what="productbeeld")
        s.save(f"carrousel-20-slide-{n}.png")
    n = total
    s = slide(f"carrousel-20-slide-{n}", total, n)
    s.pill(90, 90)
    s.text(spec["cta"][0], (90, 330, 990, 620), HEAD, 92, 40, valign="center", what="cta")
    s.rule(680, x1=300)
    s.text(spec["cta"][1], (90, 760, 990, 860), BODY_M, 44, 26, fill=SAGE, what="cta-sub")
    s.save(f"carrousel-20-slide-{n}.png")


# ============================================================ reels en stories
V_W, V_H = 1080, 1920
V_TOP, V_BOTTOM = 260, 1560  # 260 px vrij bovenaan, 360 px onderaan


def vertical(name, blobs=True, bg=SAND, tint=LIGHT):
    return Sheet(V_W, V_H, bg=bg, blobs=blobs, blob_tint=tint, margin=90,
                 safe_top=V_TOP, safe_bottom=V_BOTTOM, name=name)


REELS = [
    (1, "productdemo-planner",
     "Een Nederlandse planner voor 2027 die je gewoon in GoodNotes opent.",
     "Digitale Planner 2027", "tablet-week"),
    (3, "week-plannen",
     "Zo plan ik mijn week in drie minuten (zondagavond, thee erbij).",
     "Digitale Planner 2027", "tablet-maand"),
    (5, "printable-bundel",
     "12 printables, A4 en A5, ongedateerd. Printen en beginnen.",
     "Printable Bundel", "printable-week"),
    (6, "budgetplanner",
     "Een budgetplanner in Google Sheets die gewoon in euro's en in het Nederlands is.",
     "Budgetplanner", "budget-jaar"),
    (8, "abonnementenchecker",
     "De abonnementenchecker: dit doe ik één keer per kwartaal.",
     "Budgetplanner · tabblad Abonnementen", "budget-abonnementen"),
    (10, "ai-prompt-pack",
     "200 Nederlandse prompts. Zo werkt het.",
     "AI Prompt Pack", "prompts-kaart"),
    (11, "tentamenweek",
     "Tentamenweek plannen in 2 minuten met weeknummers.",
     "Digitale Planner 2027", "planner-maand"),
    (13, "zzp-prompts",
     "Drie prompts die ik als zzp'er elke week gebruik.",
     "AI Prompt Pack", "prompts-categorie"),
    (15, "complete-bundel",
     "Alles van Plannerij in één download. Dit zit erin.",
     "Complete Bundel 2027 · €29,95 i.p.v. €45,80", "quad"),
    (17, "gewoontetracker",
     "Mijn gewoontetracker: twee gewoontes, geen tien.",
     "Digitale Planner 2027", "tablet-gewoontes"),
    (19, "tablet-en-papier",
     "Dezelfde planner, twee manieren: tablet én papier.",
     "Digitale Planner 2027 · digitaal + printbaar", None),
]


def reel_covers():
    for post, slug, hook, sub, key in REELS:
        s = vertical(f"cover-{post}-{slug}")
        s.pill(V_W / 2, 280, center=True)
        s.text(hook, (90, 400, 990, 900), HEAD, 104, 46, fill=DARK, align="center",
               valign="center", what="hook")
        s.rule(950, x0=440, x1=640)
        s.text(sub, (90, 1000, 990, 1070), BODY_M, 38, 24, fill=SAGE, align="center", what="sub")
        img = duo("tablet-week", "printbaar-a4") if key is None else picture(key)
        s.card(img, (110, 1110, 970, 1555), what="productbeeld")
        s.save(f"cover-{post}-{slug}.png")


def stories():
    # 1 — nieuw product
    s = vertical("story-nieuw-product")
    s.pill(V_W / 2, 280, center=True)
    s.text("Nieuw in de winkel", (90, 420, 990, 500), BODY_B, 40, 26, fill=SAGE, align="center",
           what="eyebrow")
    s.text("Digitale Planner 2027", (90, 540, 990, 780), HEAD, 96, 44, align="center",
           valign="center", what="titel")
    s.text("Nederlands · weekstart op maandag · weeknummers en feestdagen NL en BE",
           (90, 820, 990, 980), BODY, 38, 24, fill=GREY, align="center", what="sub")
    s.card(asset("tablet-week"), (120, 1040, 960, 1420), what="productbeeld")
    s.text("Link in bio", (90, 1460, 990, 1540), BODY_B, 42, 28, fill=SAGE, align="center",
           what="cta")
    s.save("story-nieuw-product.png")

    # 2 — korting
    s = vertical("story-korting-welkom10", blobs=False, bg=SAGE)
    s.pill(V_W / 2, 280, center=True, fill=LIGHT, fg=SAGE_DARK)
    s.text("Kortingscode", (90, 460, 990, 540), BODY_B, 40, 26, fill=LIGHT, align="center",
           what="eyebrow")
    s.panel((120, 600, 960, 900), radius=40, fill=LIGHT, what="codepaneel")
    s.text("WELKOM10", (170, 660, 910, 840), HEAD, 130, 50, fill=SAGE_DARK, align="center",
           valign="center", what="code")
    s.text("10% korting op je eerste bestelling.", (90, 960, 990, 1110), HEAD_M, 62, 32,
           fill=WHITE, align="center", valign="center", what="uitleg")
    s.text("Geldig op alle downloads: planner, budgetplanner, printables en prompts.",
           (90, 1150, 990, 1300), BODY, 36, 22, fill=LIGHT, align="center", what="sub")
    s.text("Link in bio", (90, 1440, 990, 1530), BODY_B, 44, 28, fill=LIGHT, align="center",
           what="cta")
    s.save("story-korting-welkom10.png")

    # 3 — vraag / poll
    s = vertical("story-vraag-poll")
    s.pill(V_W / 2, 280, center=True)
    s.text("Een vraag", (90, 420, 990, 500), BODY_B, 40, 26, fill=SAGE, align="center",
           what="eyebrow")
    s.text("Hoe plan jij je week: digitaal of op papier?", (90, 560, 990, 900), HEAD, 96, 44,
           align="center", valign="center", what="vraag")
    s.panel((150, 960, 930, 1120), radius=36, fill=WHITE, what="optie1")
    s.text("Digitaal, op mijn tablet", (200, 990, 880, 1090), BODY_M, 44, 26, fill=DARK,
           align="center", valign="center", what="optie1-tekst")
    s.panel((150, 1160, 930, 1320), radius=36, fill=WHITE, what="optie2")
    s.text("Op papier, geprint", (200, 1190, 880, 1290), BODY_M, 44, 26, fill=DARK,
           align="center", valign="center", what="optie2-tekst")
    # onderaan blijft ruimte vrij voor de poll-sticker van Instagram
    s.save("story-vraag-poll.png")

    # 4 — link in bio
    s = vertical("story-link-in-bio")
    s.pill(V_W / 2, 280, center=True)
    s.text("Alles staat in de winkel", (90, 430, 990, 620), HEAD, 78, 36, align="center",
           valign="center", what="titel")
    items = ["Digitale Planner 2027", "Budgetplanner", "AI Prompt Pack", "Printable Bundel",
             "Complete Bundel 2027"]
    y = 700
    for it in items:
        s.panel((160, y, 920, y + 116), radius=32, fill=WHITE, what=f"rij {it}")
        s.text(it, (210, y + 24, 870, y + 92), BODY_M, 40, 24, fill=DARK, align="center",
               valign="center", what=it)
        y += 140
    s.text("Link in bio · WELKOM10 voor 10% korting", (90, 1420, 990, 1540), BODY_B, 40, 24,
           fill=SAGE, align="center", valign="center", what="cta")
    s.save("story-link-in-bio.png")


# ================================================================== feedposts
def feedposts():
    # post 4 — digitaal of papier
    s = Sheet(SQ, SQ, name="feed-4")
    s.pill(90, 90)
    s.text("Digitaal of papier?\nJe hoeft niet te kiezen.", (90, 230, 990, 470), HEAD, 82, 38,
           valign="center", what="hook")
    s.card(duo("tablet-week", "printbaar-a4"), (110, 520, 970, 900), what="beeld")
    s.text("Hyperlinked PDF + printbare A4/A5 · link in bio", (90, 930, 990, 990), BODY_M, 32, 22,
           fill=SAGE, what="sub")
    s.save("feed-4-digitaal-of-papier.png")

    # post 9 — 52-weken spaarchallenge
    s = Sheet(SQ, SQ, name="feed-9")
    s.pill(90, 90)
    s.text("Spaarchallenge 52 weken", (90, 240, 990, 310), BODY_B, 38, 24, fill=SAGE,
           what="eyebrow")
    s.text("€1 in week 1, €52 in week 52", (90, 340, 990, 500), HEAD, 76, 36, valign="center",
           what="hook")
    s.panel((90, 540, 990, 790), radius=40, fill=LIGHT, what="bedragpaneel")
    s.text("= €1.378", (140, 580, 940, 750), HEAD, 150, 60, fill=SAGE_DARK, align="center",
           valign="center", what="bedrag")
    s.text("Het tabblad staat klaar in de Budgetplanner en telt mee op je dashboard. Link in bio.",
           (90, 830, 990, 980), BODY, 34, 22, fill=GREY, what="sub")
    s.save("feed-9-spaarchallenge-52-weken.png")

    # post 14 — brain dump
    s = Sheet(SQ, SQ, name="feed-14")
    s.pill(90, 90)
    s.text("Als je hoofd vol is:\néén vel, één kader, alles eruit.", (90, 280, 990, 600), HEAD,
           84, 38, valign="center", what="hook")
    s.rule(660, x1=300)
    s.text("Brain dump uit de Printable Bundel. Sorteren komt daarna, met de dagplanner.",
           (90, 730, 640, 930), BODY, 34, 22, fill=GREY, what="sub")
    s.card(asset("printable-dag"), (700, 640, 990, 960), radius=14, what="beeld")
    s.save("feed-14-brain-dump.png")

    # post 18 — prompt
    s = Sheet(SQ, SQ, name="feed-18")
    s.pill(90, 90)
    s.text("AI Prompt Pack · Productiviteit & planning", (90, 230, 990, 290), BODY_B, 32, 22,
           fill=SAGE, what="eyebrow")
    s.panel((90, 330, 990, 720), radius=40, fill=WHITE, what="promptkaart")
    s.text("„", (130, 350, 300, 470), HEAD, 120, 60, fill=LIGHT, what="quote")
    s.text("Knip deze taak op in stappen van maximaal 20 minuten.", (150, 430, 930, 680), HEAD,
           64, 32, fill=DARK, valign="center", what="prompt")
    s.text("Plak je taak eronder, en ChatGPT of Claude geeft je een lijstje met korte, haalbare "
           "stappen. 200 Nederlandse prompts, link in bio.", (90, 770, 990, 980), BODY, 36, 22,
           fill=GREY, what="sub")
    s.save("feed-18-prompt-stappen.png")


# ===================================================================== profiel
def avatar():
    size = 320
    im = Image.new("RGBA", (size, size), SAND + (255,))
    d = ImageDraw.Draw(im)
    d.ellipse((4, 4, size - 5, size - 5), fill=SAGE + (255,))
    logo = Image.open(IMG / "logo-square.png").convert("RGB")
    inner = int(size * 0.94)
    logo = logo.resize((inner, inner), Image.LANCZOS)
    mask = Image.new("L", (inner, inner), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, inner - 1, inner - 1), fill=255)
    im.paste(logo, ((size - inner) // 2, (size - inner) // 2), mask)
    path = OUT / "profiel-avatar.png"
    im.convert("RGB").save(path, optimize=True)
    print(f"  profiel-avatar.png  {size}x{size}")


def _icon_planner(d, cx, cy, r):
    x0, y0, x1, y1 = cx - r, cy - r * 0.86, cx + r, cy + r * 0.86
    d.rounded_rectangle((x0, y0, x1, y1), radius=r * 0.16, fill=WHITE)
    d.rounded_rectangle((x0, y0, x1, y0 + r * 0.34), radius=r * 0.16, fill=SAGE)
    d.rectangle((x0, y0 + r * 0.22, x1, y0 + r * 0.34), fill=SAGE)
    for i in range(1, 4):
        y = y0 + r * 0.34 + i * (y1 - y0 - r * 0.34) / 4
        d.line((x0 + r * 0.16, y, x1 - r * 0.16, y), fill=LIGHT, width=max(2, int(r * 0.07)))
    for i in range(1, 4):
        x = x0 + i * (x1 - x0) / 4
        d.line((x, y0 + r * 0.42, x, y1 - r * 0.12), fill=LIGHT, width=max(2, int(r * 0.07)))


def _icon_budget(d, cx, cy, r):
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=WHITE)
    d.text((cx, cy + r * 0.04), "€", font=font(HEAD, int(r * 1.5)), fill=SAGE_DARK, anchor="mm")


def _icon_printables(d, cx, cy, r):
    w, h = r * 1.10, r * 1.55
    # twee vellen erachter, daarna het voorste vel met lijnen
    for i, (dx, dy) in enumerate(((r * 0.34, -r * 0.14), (r * 0.17, -r * 0.07), (0, 0))):
        x0 = cx - w / 2 + dx
        y0 = cy - h / 2 + dy
        d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=r * 0.09,
                            fill=LIGHT if i < 2 else WHITE)
        if i == 2:
            for k in range(5):
                y = y0 + h * 0.22 + k * h * 0.145
                d.line((x0 + w * 0.16, y, x0 + w * 0.84, y), fill=SAGE,
                       width=max(2, int(r * 0.06)))


def _icon_prompts(d, cx, cy, r):
    d.rounded_rectangle((cx - r, cy - r * 0.78, cx + r, cy + r * 0.42), radius=r * 0.26, fill=WHITE)
    d.polygon([(cx - r * 0.30, cy + r * 0.36), (cx - r * 0.04, cy + r * 0.36),
               (cx - r * 0.34, cy + r * 0.86)], fill=WHITE)
    for i, w in enumerate((1.30, 1.00, 0.60)):
        y = cy - r * 0.44 + i * r * 0.36
        d.line((cx - r * 0.62, y, cx - r * 0.62 + r * w, y), fill=SAGE,
               width=max(2, int(r * 0.10)))


def _icon_uitleg(d, cx, cy, r):
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=WHITE)
    d.text((cx, cy + r * 0.02), "?", font=font(HEAD, int(r * 1.45)), fill=SAGE_DARK, anchor="mm")


HIGHLIGHTS = [
    ("planner", "Planner", _icon_planner),
    ("budget", "Budget", _icon_budget),
    ("printables", "Printables", _icon_printables),
    ("prompts", "Prompts", _icon_prompts),
    ("uitleg", "Uitleg", _icon_uitleg),
]


def highlight_covers():
    """1080x1920; Instagram snijdt een cirkel uit het midden, dus alles staat
    binnen een cirkel van 520 px rond het middelpunt."""
    for slug, label, icon in HIGHLIGHTS:
        s = Sheet(V_W, V_H, bg=SAGE, blobs=True, blob_tint=SAGE_DARK, margin=90,
                  safe_top=V_TOP, safe_bottom=V_BOTTOM, name=f"highlight-{slug}")
        cx, cy = V_W / 2, V_H / 2
        s.d.ellipse((cx - 300, cy - 300, cx + 300, cy + 300), fill=SAGE_DARK)
        icon(s.d, cx, cy - 60, 110)
        s.text(label, (cx - 230, cy + 110, cx + 230, cy + 200), BODY_B, 56, 30, fill=WHITE,
               align="center", valign="center", what="label")
        s.save(f"highlight-{slug}.png")


# ======================================================================== main
def main(argv):
    what = argv or ["carrousel", "cover", "story", "feed", "profiel"]
    if "carrousel" in what:
        print("Carrousels:")
        for post, spec in CAROUSELS.items():
            carousel(post, spec)
        carousel_20()
    if "cover" in what:
        print("Reelcovers:")
        reel_covers()
    if "story" in what:
        print("Stories:")
        stories()
    if "feed" in what:
        print("Feedposts:")
        feedposts()
    if "profiel" in what:
        print("Profiel:")
        avatar()
        highlight_covers()
    print(f"\nKlaar. Map: {OUT}")


if __name__ == "__main__":
    main(sys.argv[1:])
