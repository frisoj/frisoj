"""Plannerij Printable Bundel – undated A4 (and A5) printables."""
import os
import sys

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, A5

sys.path.insert(0, os.path.dirname(__file__))
from style import *  # noqa
from calendar_data import DAGEN, DAGEN_KORT  # noqa

OUT = "/tmp/claude-0/-home-user-frisoj/b2406013-c3ca-5da6-8b93-0de4c5b2366a/scratchpad/out/printables"
os.makedirs(OUT, exist_ok=True)
register_fonts()

PW, PH = A4
X0, X1 = 40, PW - 40
TOPY = PH - 92


def header(c, title, sub=None, date_line=True):
    text(c, X0, PH - 60, title, "Playfair-SemiBold", 24, DARK)
    if sub:
        text(c, X0, PH - 76, sub, "Inter", 9.5, GREY)
    if date_line:
        text(c, X1 - 150, PH - 60, "Datum", "Inter-Medium", 9, GREY)
        hline(c, X1 - 112, X1, PH - 62, color=GREY)
    hline(c, X0, X1, PH - 84, color=SAGE, lw=1)
    text(c, X0, 28, "Plannerij · Printables", "Inter", 7.5, GREY)
    text(c, X1, 28, "plannerij.nl", "Inter", 7.5, GREY, "right")


def box(c, x, ytop, w, h, title, fill=WHITE):
    rect(c, x, ytop - h, w, h, fill=fill, stroke=LINE, radius=8)
    text(c, x + 10, ytop - 16, title, "Inter-SemiBold", 10, SAGE_DARK)


def cover(c):
    rect(c, 0, 0, PW, PH, fill=SAND)
    rect(c, 0, PH * 0.45, PW, PH * 0.55, fill=SAGE)
    text(c, 50, PH - 90, "Plannerij", "Playfair-SemiBold", 26, WHITE)
    text(c, 50, PH * 0.45 + 90, "Printable", "Playfair-Bold", 72, WHITE)
    text(c, 50, PH * 0.45 + 30, "Bundel", "Playfair-Bold", 72, WHITE)
    text(c, 50, PH * 0.45 - 50, "12 ongedateerde planners & trackers", "Playfair-SemiBold", 20, DARK)
    items = ["Weekplanner (2 varianten)", "Dagplanner met tijdblokken", "Gewoontetracker (maand)",
             "To-do & prioriteiten", "Brain dump", "Maaltijdplanner + boodschappenlijst",
             "Doelen werkblad", "Maandbudget in één oogopslag", "Schoonmaakschema",
             "Notities (lijn & stip)"]
    y = PH * 0.45 - 86
    for it in items:
        c.setFillColor(SAGE)
        c.circle(56, y + 3.5, 2.6, stroke=0, fill=1)
        text(c, 68, y, it, "Inter", 11, DARK)
        y -= 20
    text(c, 50, 60, "Print op A4 of A5 · © 2026 Plannerij · Persoonlijk gebruik", "Inter", 8, GREY)
    c.showPage()


def weekplanner_columns(c):
    header(c, "Weekplanner", "Plan je week in één overzicht", date_line=False)
    text(c, X1 - 150, PH - 60, "Week van", "Inter-Medium", 9, GREY)
    hline(c, X1 - 100, X1, PH - 62, color=GREY)
    colw = (X1 - X0 - 12) / 2
    rowh = (TOPY - 44) / 4
    slots = [(0, 0, 0), (1, 0, 1), (2, 0, 2), (3, 0, 3), (4, 1, 0), (5, 1, 1), (6, 1, 2)]
    for di, col, row in slots:
        x = X0 + col * (colw + 12)
        ytop = TOPY - row * rowh
        box(c, x, ytop, colw, rowh - 8, DAGEN[di].capitalize(), fill=SAND if di >= 5 else WHITE)
        ruled(c, x + 10, ytop - 22, colw - 20, rowh - 38, spacing=17)
    x = X0 + colw + 12
    ytop = TOPY - 3 * rowh
    box(c, x, ytop, colw, ytop - 44, "Deze week wil ik")
    yy = ytop - 36
    for _ in range(3):
        checkbox(c, x + 10, yy - 1, size=9)
        hline(c, x + 26, x + colw - 10, yy - 1, color=LINE_SOFT)
        yy -= 20
    ruled(c, x + 10, yy + 6, colw - 20, yy - 44, spacing=17)
    c.showPage()


def weekplanner_rows(c):
    header(c, "Weekplanner", "Horizontaal: dagen als rijen, met to-do en notities", date_line=False)
    text(c, X1 - 150, PH - 60, "Week van", "Inter-Medium", 9, GREY)
    hline(c, X1 - 100, X1, PH - 62, color=GREY)
    leftw = (X1 - X0) * 0.62
    rowh = (TOPY - 44) / 7
    for i in range(7):
        ytop = TOPY - i * rowh
        rect(c, X0, ytop - rowh + 4, leftw, rowh - 4, fill=SAND if i >= 5 else WHITE, stroke=LINE, radius=6)
        text(c, X0 + 10, ytop - 14, DAGEN[i].capitalize(), "Inter-SemiBold", 9.5, SAGE_DARK)
        ruled(c, X0 + 90, ytop - 4, leftw - 100, rowh - 10, spacing=16)
    x = X0 + leftw + 12
    w = X1 - x
    box(c, x, TOPY, w, (TOPY - 44) * 0.55, "To-do")
    yy = TOPY - 36
    while yy > TOPY - (TOPY - 44) * 0.55 + 10:
        checkbox(c, x + 10, yy - 1, size=8)
        hline(c, x + 24, x + w - 10, yy - 1, color=LINE_SOFT)
        yy -= 18
    ytop2 = TOPY - (TOPY - 44) * 0.55 - 10
    box(c, x, ytop2, w, ytop2 - 44, "Notities")
    ruled(c, x + 10, ytop2 - 22, w - 20, ytop2 - 44 - 30, spacing=17)
    c.showPage()


def dagplanner(c):
    header(c, "Dagplanner", "Tijdblokken, prioriteiten en een moment voor jezelf")
    leftw = (X1 - X0) * 0.5
    rect(c, X0, 44, leftw, TOPY - 44, fill=WHITE, stroke=LINE, radius=8)
    text(c, X0 + 10, TOPY - 16, "Planning", "Inter-SemiBold", 10, SAGE_DARK)
    hours = list(range(6, 23))
    step = (TOPY - 44 - 30) / len(hours)
    for i, h in enumerate(hours):
        y = TOPY - 30 - i * step
        text(c, X0 + 10, y - step / 2 - 3, f"{h:02d}:00", "Inter-Medium", 8, GREY)
        hline(c, X0 + 46, X0 + leftw - 10, y - step, color=LINE_SOFT)
        hline(c, X0 + 46, X0 + leftw - 10, y - step / 2, color=LINE_SOFT, dash=(1, 3))
    x = X0 + leftw + 12
    w = X1 - x
    ytop = TOPY
    box(c, x, ytop, w, 96, "Top 3 vandaag")
    yy = ytop - 38
    for _ in range(3):
        checkbox(c, x + 10, yy - 1, size=9)
        hline(c, x + 26, x + w - 10, yy - 1, color=LINE_SOFT)
        yy -= 22
    ytop -= 108
    box(c, x, ytop, w, 150, "To-do")
    yy = ytop - 36
    while yy > ytop - 150 + 10:
        checkbox(c, x + 10, yy - 1, size=8)
        hline(c, x + 24, x + w - 10, yy - 1, color=LINE_SOFT)
        yy -= 18
    ytop -= 162
    box(c, x, ytop, w, 80, "Water & beweging", fill=SAND)
    for i in range(8):
        circle_box(c, x + 18 + i * 20, ytop - 40, r=6, color=SAGE)
    text(c, x + 10, ytop - 62, "Beweging:", "Inter", 8.5, GREY)
    hline(c, x + 58, x + w - 10, ytop - 64, color=LINE_SOFT)
    ytop -= 92
    box(c, x, ytop, w, 100, "Maaltijden")
    for i, m in enumerate(["Ontbijt", "Lunch", "Diner"]):
        text(c, x + 10, ytop - 36 - i * 20, m, "Inter", 8.5, GREY)
        hline(c, x + 50, x + w - 10, ytop - 38 - i * 20, color=LINE_SOFT)
    ytop -= 112
    box(c, x, ytop, w, ytop - 44, "Waar ben ik dankbaar voor")
    ruled(c, x + 10, ytop - 22, w - 20, ytop - 44 - 30, spacing=17)
    c.showPage()


def gewoontetracker(c):
    header(c, "Gewoontetracker", "Kleur een bolletje per dag dat je de gewoonte deed", date_line=False)
    text(c, X1 - 150, PH - 60, "Maand", "Inter-Medium", 9, GREY)
    hline(c, X1 - 112, X1, PH - 62, color=GREY)
    labelw = 140
    colw = (X1 - X0 - labelw) / 31
    nrows = 12
    rowh = 24
    for d in range(31):
        cx = X0 + labelw + colw * d + colw / 2
        text(c, cx, TOPY - 14, str(d + 1), "Inter-Medium", 6.5, DARK, "center")
    hline(c, X0, X1, TOPY - 20, color=LINE)
    text(c, X0, TOPY - 14, "Gewoonte", "Inter-SemiBold", 8, GREY)
    for r in range(nrows):
        ytop = TOPY - 20 - r * rowh
        hline(c, X0, X1, ytop - rowh, color=LINE_SOFT)
        for d in range(31):
            cx = X0 + labelw + colw * d + colw / 2
            circle_box(c, cx, ytop - rowh / 2, r=3.6)
    by = TOPY - 20 - nrows * rowh - 20
    third = (X1 - X0 - 20) / 3
    for i, lbl in enumerate(["Wat ging goed", "Wat kan beter", "Volgende maand"]):
        x = X0 + i * (third + 10)
        box(c, x, by, third, by - 44, lbl)
        ruled(c, x + 10, by - 22, third - 20, by - 44 - 30, spacing=17)
    c.showPage()


def todo(c):
    header(c, "To-do & prioriteiten", "Eerst wat moet, dan wat kan")
    colw = (X1 - X0 - 12) / 2
    h = (TOPY - 44 - 12) / 2
    quads = [("Belangrijk & dringend", "Doe het nu"), ("Belangrijk, niet dringend", "Plan het in"),
             ("Dringend, niet belangrijk", "Delegeer of beperk"), ("Niet dringend, niet belangrijk", "Laat los")]
    for i, (t, s) in enumerate(quads):
        col, row = i % 2, i // 2
        x = X0 + col * (colw + 12)
        ytop = TOPY - row * (h + 12)
        box(c, x, ytop, colw, h, t, fill=LIGHT if i == 0 else WHITE)
        text(c, x + 10, ytop - 28, s, "Inter", 8, GREY)
        yy = ytop - 48
        while yy > ytop - h + 10:
            checkbox(c, x + 10, yy - 1, size=8)
            hline(c, x + 24, x + colw - 10, yy - 1, color=LINE_SOFT)
            yy -= 18
    c.showPage()


def brain_dump(c):
    header(c, "Brain dump", "Alles uit je hoofd, op papier. Sorteer daarna.")
    rect(c, X0, 44, X1 - X0, TOPY - 44, fill=WHITE, stroke=LINE, radius=8)
    dots(c, X0 + 6, 50, X1 - X0 - 12, TOPY - 56, step=16)
    h = 110
    rect(c, X0, 44, X1 - X0, h, fill=SAND, radius=8)
    third = (X1 - X0 - 20) / 3
    for i, lbl in enumerate(["Nu doen", "Later plannen", "Loslaten"]):
        x = X0 + 10 + i * third
        text(c, x, 44 + h - 18, lbl, "Inter-SemiBold", 9.5, SAGE_DARK)
        ruled(c, x, 44 + h - 24, third - 16, h - 34, spacing=17)
    c.showPage()


def maaltijdplanner(c):
    header(c, "Maaltijdplanner", "Weekmenu en boodschappenlijst", date_line=False)
    text(c, X1 - 150, PH - 60, "Week van", "Inter-Medium", 9, GREY)
    hline(c, X1 - 100, X1, PH - 62, color=GREY)
    leftw = (X1 - X0) * 0.6
    top = TOPY - 14
    rowh = (top - 44) / 7
    cols = ["Ontbijt", "Lunch", "Diner"]
    cw = (leftw - 70) / 3
    for j, cl in enumerate(cols):
        text(c, X0 + 70 + j * cw + cw / 2, TOPY - 6, cl, "Inter-Medium", 8, GREY, "center")
    for i in range(7):
        ytop = top - i * rowh
        wk = i >= 5
        rect(c, X0, ytop - rowh + 4, leftw, rowh - 4, fill=SAND if wk else WHITE, stroke=LINE, radius=6)
        text(c, X0 + 10, ytop - 14, DAGEN_KORT[i].upper(), "Inter-SemiBold", 9.5, SAGE_DARK)
        for j in range(3):
            vline(c, X0 + 70 + j * cw, ytop - rowh + 8, ytop - 4, color=LINE if wk else LINE_SOFT)
            ruled(c, X0 + 74 + j * cw, ytop - 6, cw - 8, rowh - 14, spacing=15, color=LINE if wk else LINE_SOFT)
    x = X0 + leftw + 12
    w = X1 - x
    box(c, x, TOPY, w, TOPY - 44, "Boodschappen")
    yy = TOPY - 36
    while yy > 54:
        checkbox(c, x + 10, yy - 1, size=8)
        hline(c, x + 24, x + w - 10, yy - 1, color=LINE_SOFT)
        yy -= 17
    c.showPage()


def doelen(c):
    header(c, "Doelen werkblad", "Van groot doel naar kleine stappen")
    box(c, X0, TOPY, X1 - X0, 70, "Mijn doel")
    ruled(c, X0 + 10, TOPY - 22, X1 - X0 - 20, 42, spacing=20)
    y = TOPY - 82
    colw = (X1 - X0 - 12) / 2
    box(c, X0, y, colw, 110, "Waarom is dit belangrijk voor mij?")
    ruled(c, X0 + 10, y - 22, colw - 20, 80, spacing=18)
    box(c, X0 + colw + 12, y, colw, 110, "Hoe weet ik dat het gelukt is?")
    ruled(c, X0 + colw + 22, y - 22, colw - 20, 80, spacing=18)
    y -= 122
    box(c, X0, y, X1 - X0, 190, "Stappen")
    for i in range(7):
        yy = y - 40 - i * 21
        checkbox(c, X0 + 10, yy - 1, size=9)
        text(c, X0 + 26, yy, f"{i + 1}.", "Inter", 8.5, GREY)
        hline(c, X0 + 40, X0 + (X1 - X0) * 0.72, yy - 1, color=LINE_SOFT)
        text(c, X0 + (X1 - X0) * 0.75, yy, "Deadline", "Inter", 7.5, GREY)
        hline(c, X0 + (X1 - X0) * 0.82, X1 - 10, yy - 1, color=LINE_SOFT)
    y -= 202
    box(c, X0, y, colw, y - 44, "Mogelijke obstakels & oplossingen")
    ruled(c, X0 + 10, y - 22, colw - 20, y - 44 - 30, spacing=18)
    box(c, X0 + colw + 12, y, colw, y - 44, "Beloning als het gelukt is", fill=SAND)
    ruled(c, X0 + colw + 22, y - 22, colw - 20, y - 44 - 30, spacing=18)
    c.showPage()


def maandbudget(c):
    header(c, "Maandbudget", "Inkomen, vaste lasten en variabele uitgaven in één oogopslag", date_line=False)
    text(c, X1 - 150, PH - 60, "Maand", "Inter-Medium", 9, GREY)
    hline(c, X1 - 112, X1, PH - 62, color=GREY)
    colw = (X1 - X0 - 12) / 2

    def table(x, ytop, w, h, title, rows, cols=("Omschrijving", "Begroot", "Werkelijk")):
        box(c, x, ytop, w, h, title)
        cw = [w * 0.5, w * 0.25, w * 0.25]
        xx = x
        for j, cl in enumerate(cols):
            text(c, xx + 6, ytop - 30, cl, "Inter-Medium", 7.5, GREY)
            xx += cw[j]
        hline(c, x, x + w, ytop - 34, color=LINE)
        rh = (h - 52) / rows
        for i in range(rows):
            yy = ytop - 34 - (i + 1) * rh
            hline(c, x, x + w, yy, color=LINE_SOFT)
        vline(c, x + cw[0], ytop - 34, ytop - h + 18, color=LINE_SOFT)
        vline(c, x + cw[0] + cw[1], ytop - 34, ytop - h + 18, color=LINE_SOFT)
        text(c, x + 6, ytop - h + 7, "Totaal", "Inter-SemiBold", 8, SAGE_DARK)

    table(X0, TOPY, colw, 150, "Inkomen", 5)
    table(X0 + colw + 12, TOPY, colw, 150, "Sparen", 5, ("Doel", "Begroot", "Werkelijk"))
    table(X0, TOPY - 162, colw, 300, "Vaste lasten", 12)
    table(X0 + colw + 12, TOPY - 162, colw, 300, "Variabele uitgaven", 12)
    y = TOPY - 474
    rect(c, X0, 44, X1 - X0, y - 44, fill=SAND, radius=8)
    labels = ["Inkomen", "– Vaste lasten", "– Variabel", "– Sparen", "= Over / tekort"]
    cw = (X1 - X0 - 20) / 5
    for i, l in enumerate(labels):
        x = X0 + 10 + i * cw
        text(c, x, y - 18, l, "Inter-SemiBold", 8.5, SAGE_DARK)
        rect(c, x, 54, cw - 12, y - 30 - 54, fill=WHITE, stroke=LINE, radius=6)
        text(c, x + 6, 60, "€", "Inter", 9, GREY)
    c.showPage()


def schoonmaak(c):
    header(c, "Schoonmaakschema", "Verdeel taken over de week, kleine stapjes houden het huis op orde", date_line=False)
    text(c, X1 - 150, PH - 60, "Week van", "Inter-Medium", 9, GREY)
    hline(c, X1 - 100, X1, PH - 62, color=GREY)
    labelw = 160
    cw = (X1 - X0 - labelw) / 7
    for i, d in enumerate(DAGEN_KORT):
        text(c, X0 + labelw + i * cw + cw / 2, TOPY - 12, d.upper(), "Inter-Medium", 8, GREY, "center")
    hline(c, X0, X1, TOPY - 18, color=LINE)
    rooms = ["Keuken", "Badkamer", "Woonkamer", "Slaapkamer", "Was", "Stofzuigen", "Dweilen", "Ramen",
             "Afval & papier", "Boodschappen", "Planten", "Extra"]
    rowh = 24
    for r, room in enumerate(rooms):
        ytop = TOPY - 18 - r * rowh
        text(c, X0 + 4, ytop - 16, room, "Inter", 9, DARK)
        hline(c, X0, X1, ytop - rowh, color=LINE_SOFT)
        for i in range(7):
            checkbox(c, X0 + labelw + i * cw + cw / 2 - 5, ytop - 17, size=10)
    y = TOPY - 18 - len(rooms) * rowh - 16
    colw = (X1 - X0 - 12) / 2
    box(c, X0, y, colw, y - 44, "Maandelijks")
    yy = y - 36
    while yy > 54:
        checkbox(c, X0 + 10, yy - 1, size=8)
        hline(c, X0 + 24, X0 + colw - 10, yy - 1, color=LINE_SOFT)
        yy -= 18
    box(c, X0 + colw + 12, y, colw, y - 44, "Per seizoen", fill=SAND)
    yy = y - 36
    while yy > 54:
        checkbox(c, X0 + colw + 22, yy - 1, size=8)
        hline(c, X0 + colw + 36, X1 - 10, yy - 1, color=LINE_SOFT)
        yy -= 18
    c.showPage()


def notities(c, kind):
    header(c, "Notities", {"lines": "gelinieerd", "dots": "stippen"}[kind])
    if kind == "lines":
        ruled(c, X0, TOPY + 4, X1 - X0, TOPY - 44, spacing=22, color=LINE)
    else:
        dots(c, X0, 44, X1 - X0, TOPY - 44, step=18)
    c.showPage()


PAGES = [cover, weekplanner_columns, weekplanner_rows, dagplanner, gewoontetracker, todo, brain_dump,
         maaltijdplanner, doelen, maandbudget, schoonmaak, (notities, "lines"), (notities, "dots")]


def build(pagesize, name):
    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=pagesize)
    c.setTitle("Plannerij Printable Bundel")
    c.setAuthor("Plannerij")
    scale = pagesize[0] / A4[0]
    for p in PAGES:
        c.scale(scale, scale)
        if isinstance(p, tuple):
            p[0](c, p[1])
        else:
            p(c)
    c.save()
    return path


if __name__ == "__main__":
    print(build(A4, "Plannerij-Printable-Bundel-A4.pdf"))
    print(build(A5, "Plannerij-Printable-Bundel-A5.pdf"))
