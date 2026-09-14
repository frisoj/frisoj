"""Plannerij Gratis Weekplanner + Gewoontetracker – 4 ongedateerde pagina's (A4 + A5).

De gratis weggever van Plannerij. Zelfde stijl als make_printables.py, maar
compacter: weekplanner, gewoontetracker, brain dump en een uitlegpagina.

    python3 make_gratis.py

Schrijft naar ../producten/Plannerij-Gratis-Weekplanner-A4.pdf en -A5.pdf.
"""
import os
import sys

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, A5
from reportlab.pdfbase import pdfmetrics

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import style  # noqa: E402

# style.py wijst standaard naar een scratch-map; gebruik de fonts uit deze repo.
style.FONT_DIR = os.path.join(HERE, "fonts")

from style import *  # noqa: E402,F401,F403
from calendar_data import DAGEN  # noqa: E402

register_fonts()

OUT = os.path.abspath(os.path.join(HERE, "..", "producten"))
os.makedirs(OUT, exist_ok=True)

SHOP_URL = "umaktx-cz.myshopify.com"
TITEL = "Plannerij Gratis Weekplanner + Gewoontetracker"

PW, PH = A4
X0, X1 = 40, PW - 40
TOPY = PH - 92


# ----------------------------------------------------------------- helpers
def header(c, title, sub=None, veld=None):
    """Kop met titel, subtitel, sage-lijn en (optioneel) een invulveld rechts."""
    text(c, X0, PH - 60, title, "Playfair-SemiBold", 24, DARK)
    if sub:
        text(c, X0, PH - 76, sub, "Inter", 9.5, GREY)
    if veld:
        text(c, X1 - 150, PH - 60, veld, "Inter-Medium", 9, GREY)
        w = pdfmetrics.stringWidth(veld, "Inter-Medium", 9)
        hline(c, X1 - 150 + w + 8, X1, PH - 62, color=GREY)
    hline(c, X0, X1, PH - 84, color=SAGE, lw=1)


def footer(c):
    text(c, X0, 28, "Plannerij · Gratis weekplanner + gewoontetracker", "Inter", 7.5, GREY)
    text(c, X1, 28, SHOP_URL, "Inter", 7.5, GREY, "right")


def box(c, x, ytop, w, h, title, fill=WHITE, title_color=SAGE_DARK):
    rect(c, x, ytop - h, w, h, fill=fill, stroke=LINE, radius=8)
    if title:
        text(c, x + 10, ytop - 17, title, "Inter-SemiBold", 10, title_color)


def para(c, x, y, w, s, font="Inter", size=9.5, leading=14, color=DARK):
    """Eenvoudige woordafbreking; geeft de y onder de laatste regel terug."""
    words = s.split()
    line = ""
    for word in words:
        test = (line + " " + word).strip()
        if pdfmetrics.stringWidth(test, font, size) > w and line:
            text(c, x, y, line, font, size, color)
            y -= leading
            line = word
        else:
            line = test
    if line:
        text(c, x, y, line, font, size, color)
        y -= leading
    return y


# ----------------------------------------------------------------- pagina 1
def weekplanner(c):
    header(c, "Weekplanner", "Ongedateerd – vul zelf het weeknummer en de datums in", veld="Week")

    # Drie prioriteiten
    ph = 74
    box(c, X0, TOPY, X1 - X0, ph, "Mijn drie prioriteiten deze week", fill=LIGHT)
    colw = (X1 - X0 - 20) / 3
    for i in range(3):
        x = X0 + 10 + i * colw
        c.setFillColor(SAGE)
        c.circle(x + 8, TOPY - 48, 8, stroke=0, fill=1)
        text(c, x + 8, TOPY - 51, str(i + 1), "Inter-SemiBold", 8, WHITE, "center")
        hline(c, x + 24, x + colw - 12, TOPY - 52, color=SAGE, lw=0.5)

    # Dagen in twee kolommen: ma-do links, vr-zo + notities rechts
    top = TOPY - ph - 12
    cw = (X1 - X0 - 12) / 2
    rowh = (top - 44) / 4
    bh = rowh - 10
    slots = [(0, 0, 0), (1, 0, 1), (2, 0, 2), (3, 0, 3),
             (4, 1, 0), (5, 1, 1), (6, 1, 2)]
    for di, col, row in slots:
        x = X0 + col * (cw + 12)
        ytop = top - row * rowh
        weekend = di >= 5
        box(c, x, ytop, cw, bh, DAGEN[di].capitalize(), fill=SAND if weekend else WHITE)
        ruled(c, x + 10, ytop - 24, cw - 20, bh - 30, spacing=18,
              color=LINE if weekend else LINE_SOFT)

    # Notities-vak rechtsonder
    x = X0 + cw + 12
    ytop = top - 3 * rowh
    box(c, x, ytop, cw, bh, "Notities & losse ideeën")
    dots(c, x + 8, ytop - bh + 8, cw - 16, bh - 34, step=16)

    footer(c)
    c.showPage()


# ----------------------------------------------------------------- pagina 2
def gewoontetracker(c):
    header(c, "Gewoontetracker", "Kleur een rondje voor elke dag dat het gelukt is", veld="Maand")

    labelw = 140
    ndays = 31
    cw = (X1 - X0 - labelw) / ndays
    nrows = 16
    rowh = 26

    text(c, X0, TOPY - 14, "Gewoonte", "Inter-SemiBold", 8, GREY)
    for d in range(ndays):
        cx = X0 + labelw + cw * d + cw / 2
        text(c, cx, TOPY - 14, str(d + 1), "Inter-Medium", 6.5, DARK, "center")
    hline(c, X0, X1, TOPY - 20, color=LINE)

    for r in range(nrows):
        ytop = TOPY - 20 - r * rowh
        hline(c, X0, X1, ytop - rowh, color=LINE_SOFT)
        for d in range(ndays):
            cx = X0 + labelw + cw * d + cw / 2
            circle_box(c, cx, ytop - rowh / 2, r=3.6)
    vline(c, X0 + labelw - 6, TOPY - 20 - nrows * rowh, TOPY - 20, color=LINE)

    # Terugblik
    y = TOPY - 20 - nrows * rowh - 22
    colw = (X1 - X0 - 12) / 2
    box(c, X0, y, colw, y - 44, "Wat ging goed deze maand")
    ruled(c, X0 + 10, y - 24, colw - 20, y - 44 - 30, spacing=18)
    box(c, X0 + colw + 12, y, colw, y - 44, "Waar let ik volgende maand op", fill=SAND)
    ruled(c, X0 + colw + 22, y - 24, colw - 20, y - 44 - 30, spacing=18, color=LINE)

    footer(c)
    c.showPage()


# ----------------------------------------------------------------- pagina 3
def brain_dump(c):
    header(c, "Brain dump", "Alles uit je hoofd op papier – sorteer het daarna pas")

    bandh = 150
    bandtop = 44 + bandh
    rect(c, X0, bandtop, X1 - X0, TOPY - bandtop, fill=WHITE, stroke=LINE, radius=8)
    dots(c, X0 + 8, bandtop + 8, X1 - X0 - 16, TOPY - bandtop - 16, step=16)

    rect(c, X0, 44, X1 - X0, bandh, fill=SAND, stroke=LINE, radius=8)
    third = (X1 - X0 - 20) / 3
    for i, lbl in enumerate(["Nu doen", "Later plannen", "Loslaten"]):
        x = X0 + 10 + i * third
        text(c, x, bandtop - 20, lbl, "Inter-SemiBold", 9.5, SAGE_DARK)
        ruled(c, x, bandtop - 26, third - 14, bandh - 40, spacing=17, color=LINE)

    footer(c)
    c.showPage()


# ----------------------------------------------------------------- pagina 4
STAPPEN = [
    ("Begin bij je week",
     "Vul het weeknummer in en kies drie prioriteiten. Niet tien, maar drie: dat zijn de "
     "dingen die deze week echt af moeten. Alles wat daarna nog lukt is winst."),
    ("Vul de dagen losjes in",
     "Schrijf per dag alleen op wat die dag moet gebeuren en laat bewust regels leeg. Een "
     "volgeschreven pagina voelt aan het eind van de dag als achterstand."),
    ("Kies één of twee gewoontes",
     "Zet op de gewoontetracker maximaal een paar gewoontes en kleur elke dag dat het lukte "
     "een rondje. Een gat in de rij is geen mislukking – morgen begin je gewoon opnieuw."),
    ("Leeg je hoofd op de brain dump",
     "Alles wat blijft rondzingen schrijf je op de brain-dumppagina. Sorteer het daarna in "
     "nu doen, later plannen of loslaten. Pas dan gaat het naar je weekplanner."),
]


def uitleg(c):
    rect(c, 0, PH - 150, PW, 150, fill=SAND)
    text(c, X0, PH - 66, "Plannerij", "Playfair-SemiBold", 13, SAGE_DARK)
    text(c, X0, PH - 104, "Zo gebruik je deze planner", "Playfair-SemiBold", 26, DARK)
    text(c, X0, PH - 126, "Vier pagina's, ongedateerd – begin wanneer je wilt", "Inter", 10, GREY)

    y = PH - 196
    y = para(c, X0, y, X1 - X0,
             "Deze planner is ongedateerd: je schrijft zelf de datums erbij, dus je kunt op elk "
             "moment beginnen. Print de pagina's zo vaak als je wilt, voor jezelf.",
             "Inter", 10, 15, DARK)

    y -= 18
    for i, (kop, tekst) in enumerate(STAPPEN):
        c.setFillColor(LIGHT)
        c.circle(X0 + 13, y - 5, 13, stroke=0, fill=1)
        text(c, X0 + 13, y - 9, str(i + 1), "Inter-SemiBold", 11, SAGE_DARK, "center")
        text(c, X0 + 40, y, kop, "Inter-SemiBold", 11.5, DARK)
        y = para(c, X0 + 40, y - 18, X1 - X0 - 40, tekst, "Inter", 9.5, 14, GREY)
        y -= 22

    # Printtip
    th = 96
    rect(c, X0, y - th, X1 - X0, th, fill=SAND, radius=8)
    text(c, X0 + 16, y - 24, "Printtip", "Inter-SemiBold", 10.5, SAGE_DARK)
    para(c, X0 + 16, y - 44, X1 - X0 - 32,
         "Kies in je printvenster 'werkelijke grootte' of 100% in plaats van 'passend maken', "
         "dan blijven de marges kloppen. Wil je A5? Gebruik de A5-versie en print twee pagina's "
         "op één A4-vel, of print op A5-papier.",
         "Inter", 9.5, 14, DARK)

    # Wat er nog meer is
    y = y - th - 40
    text(c, X0, y, "Meer van Plannerij", "Inter-SemiBold", 11.5, DARK)
    y = para(c, X0, y - 20, X1 - X0,
             "Deze gratis planner komt uit het assortiment van Plannerij. In de winkel vind je "
             "onder andere:", "Inter", 9.5, 14, GREY)
    y -= 4
    for item in ["Digitale Planner 2027 – voor GoodNotes, Notability en Samsung Notes, ook printbaar",
                 "Budgetplanner – voor Excel, Google Sheets en Numbers",
                 "AI Prompt Pack – 200 Nederlandse prompts",
                 "Printable Bundel – 12 ongedateerde planners en trackers"]:
        c.setFillColor(SAGE)
        c.circle(X0 + 3, y + 3.4, 2.4, stroke=0, fill=1)
        text(c, X0 + 16, y, item, "Inter", 9.5, DARK)
        y -= 17

    hline(c, X0, X1, 92, color=LINE)
    text(c, PW / 2, 70, f"Meer Nederlandse planners, budgetplanners en printables: {SHOP_URL}",
         "Inter-Medium", 9.5, SAGE_DARK, "center")
    text(c, PW / 2, 54, "© 2027 Plannerij · voor persoonlijk gebruik", "Inter", 8, GREY, "center")
    c.showPage()


PAGES = [weekplanner, gewoontetracker, brain_dump, uitleg]


def build(pagesize, name):
    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=pagesize)
    c.setTitle(TITEL)
    c.setAuthor("Plannerij")
    c.setSubject("Gratis ongedateerde weekplanner en gewoontetracker")
    scale = pagesize[0] / A4[0]
    for page in PAGES:
        c.scale(scale, scale)
        page(c)
    c.save()
    return path


if __name__ == "__main__":
    print(build(A4, "Plannerij-Gratis-Weekplanner-A4.pdf"))
    print(build(A5, "Plannerij-Gratis-Weekplanner-A5.pdf"))
