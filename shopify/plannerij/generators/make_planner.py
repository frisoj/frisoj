"""Generate the Plannerij Digitale Planner 2027 (landscape, hyperlinked) and printable A4/A5 editions."""
import datetime as dt
import os
import sys

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, A5

sys.path.insert(0, os.path.dirname(__file__))
from style import *  # noqa
from calendar_data import *  # noqa

OUT = "/tmp/claude-0/-home-user-frisoj/b2406013-c3ca-5da6-8b93-0de4c5b2366a/scratchpad/out/planner"
os.makedirs(OUT, exist_ok=True)

register_fonts()

# ---------------------------------------------------------------- digital edition
W, H = 1024, 768
TOP = 48          # top tab bar height
SIDE = 46         # right month tab column width
M = 26            # margin
CX0, CX1 = M, W - SIDE - 14      # content x range
CY0, CY1 = 20, H - TOP - 12      # content y range

SECTIONS = [("Index", "index"), ("Jaar", "jaar"), ("Doelen", "doelen"), ("Notities", "notities")]


def chrome(c, active_section=None, active_month=None, title_hint=None):
    """Top bar + right month tabs with hyperlinks."""
    # top bar
    rect(c, 0, H - TOP, W, TOP, fill=SAGE)
    text(c, M, H - TOP + 17, "Plannerij", "Playfair-SemiBold", 17, WHITE)
    text(c, M + 84, H - TOP + 17, "2027", "Inter-Medium", 12, LIGHT)
    x = W - SIDE - 14
    for label, dest in reversed(SECTIONS):
        tw = 74
        x -= tw
        if dest == active_section:
            rect(c, x, H - TOP + 8, tw - 6, TOP - 16, fill=WHITE, radius=8)
            text(c, x + (tw - 6) / 2, H - TOP + 18, label, "Inter-SemiBold", 11, SAGE, "center")
        else:
            text(c, x + (tw - 6) / 2, H - TOP + 18, label, "Inter-Medium", 11, WHITE, "center")
        link(c, dest, x, H - TOP + 4, tw, TOP - 8)
    # month tabs
    tab_h = (H - TOP - 24) / 12
    for i in range(12):
        y = H - TOP - 12 - (i + 1) * tab_h
        act = (active_month == i + 1)
        rect(c, W - SIDE, y + 2, SIDE, tab_h - 4, fill=SAGE if act else LIGHT, radius=6)
        text(c, W - SIDE / 2, y + tab_h / 2 - 4, MAANDEN_KORT[i].upper(), "Inter-SemiBold", 9,
             WHITE if act else SAGE_DARK, "center")
        link(c, f"maand{i + 1}", W - SIDE, y, SIDE, tab_h)


def cover(c):
    rect(c, 0, 0, W, H, fill=SAND)
    rect(c, 0, 0, W * 0.46, H, fill=SAGE)
    text(c, 60, H - 110, "Plannerij", "Playfair-SemiBold", 34, WHITE)
    text(c, 60, H - 140, "Digitale planner", "Inter-Medium", 14, LIGHT)
    text(c, 60, 250, "2027", "Playfair-Bold", 150, WHITE)
    text(c, 60, 200, "Gedateerd  ·  Weekstart maandag  ·  Feestdagen NL & BE", "Inter", 12, LIGHT)
    text(c, 60, 180, "Hyperlinked voor GoodNotes, Notability, Noteshelf & Samsung Notes", "Inter", 12, LIGHT)
    # right side: mini preview blocks
    x0 = W * 0.46 + 70
    text(c, x0, H - 110, "Wat zit erin", "Playfair-SemiBold", 22, DARK)
    items = ["Jaaroverzicht met alle feestdagen", "12 maandpagina's met weeknummers",
             "53 weekpagina's (ma – zo)", "Gewoontetracker per maand",
             "Doelen- en reflectiepagina's", "Notitiepagina's (lijn, stip, blanco)",
             "Overal klikbare tabbladen"]
    y = H - 150
    for it in items:
        c.setFillColor(SAGE)
        c.circle(x0 + 5, y + 4, 3.2, stroke=0, fill=1)
        text(c, x0 + 18, y, it, "Inter", 13, DARK)
        y -= 28
    rect(c, x0, 120, 380, 120, fill=WHITE, stroke=LINE, radius=10)
    text(c, x0 + 20, 205, "Tip", "Inter-SemiBold", 11, SAGE)
    text(c, x0 + 20, 185, "Tik op een maandtab rechts of op een datum om", "Inter", 11, DARK)
    text(c, x0 + 20, 169, "direct naar de juiste pagina te springen.", "Inter", 11, DARK)
    text(c, x0 + 20, 145, "Dupliceer de notitiepagina's zo vaak als je wilt.", "Inter", 11, GREY)
    c.showPage()


def index_page(c):
    c.bookmarkPage("index")
    chrome(c, "index")
    text(c, CX0, CY1 - 34, "Welkom bij je planner", "Playfair-SemiBold", 30, DARK)
    text(c, CX0, CY1 - 58, "Zo haal je het meeste uit deze digitale planner.", "Inter", 12, GREY)
    colw = (CX1 - CX0 - 30) / 2
    # left column: how to use
    y = CY1 - 100
    steps = [
        ("1", "Open in je notitie-app", "Importeer de PDF in GoodNotes, Notability, Noteshelf of Samsung Notes en schrijf met je stylus."),
        ("2", "Navigeer met de tabbladen", "De groene balk bovenaan en de maandtabs rechts zijn klikbaar. Datums in de kalender linken naar de week."),
        ("3", "Plan per maand", "Zet eerst je belangrijke data en focus op de maandpagina. Daarna verdeel je alles over de weken."),
        ("4", "Volg je gewoontes", "Elke maand heeft een gewoontetracker. Kleur een bolletje per dag dat je de gewoonte hebt gedaan."),
        ("5", "Reflecteer", "Gebruik de doelenpagina aan het begin van het jaar en kom er ieder kwartaal op terug."),
    ]
    for n, t, d in steps:
        rect(c, CX0, y - 6, 26, 26, fill=SAGE, radius=13)
        text(c, CX0 + 13, y + 2, n, "Inter-Bold", 12, WHITE, "center")
        text(c, CX0 + 38, y + 8, t, "Inter-SemiBold", 13, DARK)
        # wrap description crudely at ~62 chars
        words, line, lines = d.split(), "", []
        for w_ in words:
            if len(line) + len(w_) + 1 > 60:
                lines.append(line)
                line = w_
            else:
                line = (line + " " + w_).strip()
        lines.append(line)
        yy = y - 8
        for ln in lines:
            text(c, CX0 + 38, yy, ln, "Inter", 10.5, GREY)
            yy -= 14
        y = yy - 22
    # right column: quick links
    x = CX0 + colw + 30
    rect(c, x, CY0 + 10, colw, CY1 - 90 - CY0 - 10, fill=SAND, radius=14)
    text(c, x + 24, CY1 - 120, "Snel naar", "Playfair-SemiBold", 18, DARK)
    links = [("Jaaroverzicht 2027", "jaar"), ("Mijn doelen voor 2027", "doelen"), ("Notities", "notities")]
    yy = CY1 - 156
    for lbl, dest in links:
        rect(c, x + 24, yy - 8, colw - 48, 30, fill=WHITE, stroke=LINE, radius=8)
        text(c, x + 38, yy + 2, lbl, "Inter-Medium", 12, DARK)
        c.setFillColor(SAGE); c.circle(x + colw - 44, yy + 7, 4, stroke=0, fill=1)
        link(c, dest, x + 24, yy - 8, colw - 48, 30)
        yy -= 40
    text(c, x + 24, yy - 6, "Maanden", "Inter-SemiBold", 11, GREY)
    yy -= 34
    for i in range(12):
        col = i % 3
        row = i // 3
        bx = x + 24 + col * ((colw - 48) / 3)
        by = yy - row * 36
        bw = (colw - 48) / 3 - 8
        rect(c, bx, by - 8, bw, 28, fill=WHITE, stroke=LINE, radius=8)
        text(c, bx + bw / 2, by + 1, MAANDEN[i].capitalize(), "Inter-Medium", 10.5, DARK, "center")
        link(c, f"maand{i + 1}", bx, by - 8, bw, 28)
    c.showPage()


def mini_calendar(c, x, y, w, h, month, link_to_month=True, show_title=True, dest_prefix="week"):
    """Small month calendar with top-left origin (x, y is top)."""
    if show_title:
        text(c, x, y - 12, MAANDEN[month - 1].capitalize(), "Inter-SemiBold", 11, DARK)
        if link_to_month:
            link(c, f"maand{month}", x, y - 16, w, 18)
        y -= 20
        h -= 20
    colw = w / 7
    rows = month_grid(month)
    rowh = (h - 14) / 6
    for i, dn in enumerate(DAGEN_KORT):
        text(c, x + colw * i + colw / 2, y - 10, dn, "Inter-Medium", 7, GREY, "center")
    yy = y - 14
    for r, row in enumerate(rows):
        for i, d in enumerate(row):
            if d.month != month:
                continue
            cx = x + colw * i + colw / 2
            cy = yy - rowh * (r + 1) + rowh / 2 - 3
            hol = HOLIDAYS.get(d)
            if hol in OFFICIAL:
                c.setFillColor(LIGHT)
                c.circle(cx, cy + 2.5, min(colw, rowh) / 2 - 1, stroke=0, fill=1)
            col = RED if (d.weekday() == 6 or hol in OFFICIAL) else DARK
            text(c, cx, cy, str(d.day), "Inter", 8, col, "center")


def year_page(c):
    c.bookmarkPage("jaar")
    chrome(c, "jaar")
    text(c, CX0, CY1 - 34, "Jaaroverzicht 2027", "Playfair-SemiBold", 30, DARK)
    text(c, CX1, CY1 - 34, "Tik op een maand om te openen", "Inter", 10, GREY, "right")
    gw = (CX1 - CX0 - 3 * 22) / 4
    gh = (CY1 - 70 - CY0 - 2 * 18) / 3
    for m_ in range(12):
        col, row = m_ % 4, m_ // 4
        x = CX0 + col * (gw + 22)
        ytop = CY1 - 70 - row * (gh + 18)
        rect(c, x - 8, ytop - gh + 4, gw + 16, gh - 4, fill=WHITE, stroke=LINE_SOFT, radius=10)
        mini_calendar(c, x, ytop - 8, gw, gh - 24, m_ + 1)
    c.showPage()


def goals_page(c):
    c.bookmarkPage("doelen")
    chrome(c, "doelen")
    text(c, CX0, CY1 - 34, "Mijn doelen voor 2027", "Playfair-SemiBold", 30, DARK)
    text(c, CX0, CY1 - 58, "Wat wil je aan het eind van dit jaar bereikt hebben?", "Inter", 12, GREY)
    boxw = (CX1 - CX0 - 20) / 2
    boxh = 160
    cats = ["Werk & studie", "Gezondheid & energie", "Geld & sparen", "Relaties & plezier"]
    for i, cat in enumerate(cats):
        col, row = i % 2, i // 2
        x = CX0 + col * (boxw + 20)
        ytop = CY1 - 80 - row * (boxh + 16)
        rect(c, x, ytop - boxh, boxw, boxh, fill=WHITE, stroke=LINE, radius=12)
        rect(c, x, ytop - 30, boxw, 30, fill=LIGHT, radius=12)
        rect(c, x, ytop - 30, boxw, 14, fill=LIGHT)
        text(c, x + 14, ytop - 20, cat, "Inter-SemiBold", 12, SAGE_DARK)
        ruled(c, x + 14, ytop - 36, boxw - 28, boxh - 44, spacing=22)
    y = CY1 - 80 - 2 * (boxh + 16) + 6
    rect(c, CX0, CY0 + 8, CX1 - CX0, y - CY0 - 8, fill=SAND, radius=12)
    text(c, CX0 + 16, y - 24, "Mijn woord voor 2027:", "Inter-SemiBold", 12, SAGE_DARK)
    hline(c, CX0 + 160, CX0 + 420, y - 26, color=GREY)
    text(c, CX0 + 16, y - 52, "Kwartaaldoelen", "Inter-SemiBold", 12, SAGE_DARK)
    qw = (CX1 - CX0 - 32 - 3 * 12) / 4
    for q in range(4):
        x = CX0 + 16 + q * (qw + 12)
        text(c, x, y - 70, f"Q{q + 1}", "Inter-Bold", 10, SAGE)
        ruled(c, x, y - 74, qw, 56, spacing=18, color=LINE)
    c.showPage()


def month_page(c, month):
    c.bookmarkPage(f"maand{month}")
    chrome(c, None, month)
    text(c, CX0, CY1 - 34, f"{MAANDEN[month - 1].capitalize()} 2027", "Playfair-SemiBold", 30, DARK)
    # calendar
    sidebar = 232
    gx0, gx1 = CX0, CX1 - sidebar - 22
    gy1 = CY1 - 60
    gy0 = CY0 + 6
    rows = month_grid(month)
    wkcol = 30
    colw = (gx1 - gx0 - wkcol) / 7
    rowh = (gy1 - gy0 - 18) / len(rows)
    for i, dn in enumerate(DAGEN):
        text(c, gx0 + wkcol + colw * i + colw / 2, gy1 - 12, dn.capitalize(), "Inter-Medium", 9, GREY, "center")
    text(c, gx0 + wkcol / 2, gy1 - 12, "wk", "Inter-Medium", 8, GREY, "center")
    for r, row in enumerate(rows):
        ytop = gy1 - 18 - r * rowh
        wi = week_of(row[0])
        iso = row[0].isocalendar()[1]
        rect(c, gx0, ytop - rowh, wkcol - 4, rowh, fill=LIGHT, radius=6)
        text(c, gx0 + (wkcol - 4) / 2, ytop - rowh / 2 - 3, str(iso), "Inter-SemiBold", 9, SAGE_DARK, "center")
        if wi is not None:
            link(c, f"week{wi}", gx0, ytop - rowh, wkcol - 4, rowh)
        for i, d in enumerate(row):
            x = gx0 + wkcol + colw * i
            inm = d.month == month
            rect(c, x, ytop - rowh, colw, rowh, fill=WHITE if inm else SAND, stroke=LINE_SOFT)
            if inm:
                hol = HOLIDAYS.get(d)
                col = RED if (d.weekday() == 6 or hol in OFFICIAL) else DARK
                text(c, x + 6, ytop - 14, str(d.day), "Inter-SemiBold", 10, col)
                if hol:
                    # trim long names
                    label = hol if len(hol) <= 20 else hol[:19] + "…"
                    text(c, x + 6, ytop - 26, label, "Inter", 6.8, SAGE_DARK)
            else:
                text(c, x + 6, ytop - 14, str(d.day), "Inter", 9, LINE)
            if wi is not None:
                link(c, f"week{wi}", x, ytop - rowh, colw, rowh)
    # sidebar
    sx = CX1 - sidebar
    boxes = [("Focus deze maand", 118), ("Belangrijke data", 150), ("Te doen", None)]
    ytop = CY1 - 60
    for title, hgt in boxes:
        if hgt is None:
            hgt = ytop - gy0
        rect(c, sx, ytop - hgt, sidebar, hgt, fill=WHITE, stroke=LINE, radius=10)
        text(c, sx + 12, ytop - 18, title, "Inter-SemiBold", 11, SAGE_DARK)
        if title == "Te doen":
            yy = ytop - 40
            while yy > ytop - hgt + 8:
                checkbox(c, sx + 12, yy - 2)
                hline(c, sx + 28, sx + sidebar - 12, yy - 2, color=LINE_SOFT)
                yy -= 20
        else:
            ruled(c, sx + 12, ytop - 24, sidebar - 24, hgt - 30, spacing=20)
        ytop -= hgt + 12
    c.showPage()


def habit_page(c, month):
    c.bookmarkPage(f"gewoontes{month}")
    chrome(c, None, month)
    text(c, CX0, CY1 - 34, f"Gewoontetracker · {MAANDEN[month - 1]}", "Playfair-SemiBold", 26, DARK)
    text(c, CX1, CY1 - 34, "Kleur een bolletje per dag dat je de gewoonte deed", "Inter", 10, GREY, "right")
    ndays = (dt.date(2027, month % 12 + 1, 1) - dt.timedelta(days=1)).day if month < 12 else 31
    labelw = 170
    x0 = CX0
    gy1 = CY1 - 66
    colw = (CX1 - x0 - labelw) / 31
    nrows = 12
    rowh = 26
    # header days
    for d in range(ndays):
        date = dt.date(2027, month, d + 1)
        cx = x0 + labelw + colw * d + colw / 2
        wk = date.weekday() >= 5
        if wk:
            rect(c, x0 + labelw + colw * d, gy1 - 26 - nrows * rowh, colw, nrows * rowh + 26, fill=SAND)
        text(c, cx, gy1 - 10, DAGEN_KORT[date.weekday()][0].upper(), "Inter", 7, GREY, "center")
        text(c, cx, gy1 - 21, str(d + 1), "Inter-Medium", 8, DARK, "center")
    for r in range(nrows):
        ytop = gy1 - 26 - r * rowh
        hline(c, x0, CX1, ytop - rowh, color=LINE_SOFT)
        text(c, x0 + 4, ytop - 17, "", "Inter", 9, DARK)
        for d in range(ndays):
            cx = x0 + labelw + colw * d + colw / 2
            circle_box(c, cx, ytop - rowh / 2, r=4.6)
    hline(c, x0, CX1, gy1 - 26, color=LINE)
    text(c, x0, gy1 - 18, "Gewoonte", "Inter-SemiBold", 9, GREY)
    # bottom: reflection
    by = gy1 - 26 - nrows * rowh - 22
    rect(c, x0, CY0 + 6, CX1 - x0, by - CY0 - 6, fill=WHITE, stroke=LINE, radius=10)
    text(c, x0 + 12, by - 18, "Reflectie op deze maand", "Inter-SemiBold", 11, SAGE_DARK)
    third = (CX1 - x0 - 24) / 3
    for i, lbl in enumerate(["Wat ging goed", "Wat kan beter", "Volgende maand"]):
        text(c, x0 + 12 + i * third, by - 36, lbl, "Inter-Medium", 9, GREY)
        ruled(c, x0 + 12 + i * third, by - 40, third - 14, by - CY0 - 50, spacing=18)
    c.showPage()


def week_page(c, wi):
    iy, iw, monday = WEEKS[wi]
    c.bookmarkPage(f"week{wi}")
    thu = monday + dt.timedelta(days=3)
    chrome(c, None, thu.month if thu.year == 2027 else (1 if thu.year < 2027 else 12))
    label = f"Week {iw}" + ("" if iy == 2027 else f" ({iy})")
    text(c, CX0, CY1 - 34, label, "Playfair-SemiBold", 30, DARK)
    text(c, CX0 + 14 + c.stringWidth(label, "Playfair-SemiBold", 30), CY1 - 34, fmt_range(monday), "Inter", 12, GREY)
    # nav
    nav_y = CY1 - 38
    if wi > 0:
        rect(c, CX1 - 128, nav_y - 7, 60, 20, fill=LIGHT, radius=10)
        text(c, CX1 - 98, nav_y, "vorige", "Inter-Medium", 9.5, SAGE_DARK, "center")
        link(c, f"week{wi - 1}", CX1 - 128, nav_y - 7, 60, 20)
    if wi < len(WEEKS) - 1:
        rect(c, CX1 - 64, nav_y - 7, 64, 20, fill=SAGE, radius=10)
        text(c, CX1 - 32, nav_y, "volgende", "Inter-Medium", 9.5, WHITE, "center")
        link(c, f"week{wi + 1}", CX1 - 64, nav_y - 7, 64, 20)
    # day columns
    top = CY1 - 60
    bottom_h = 150
    day_h = top - (CY0 + bottom_h + 16)
    colw = (CX1 - CX0 - 6 * 8) / 7
    for i in range(7):
        d = monday + dt.timedelta(days=i)
        x = CX0 + i * (colw + 8)
        wk = i >= 5
        rect(c, x, top - day_h, colw, day_h, fill=SAND if wk else WHITE, stroke=LINE, radius=10)
        rect(c, x, top - 34, colw, 34, fill=LIGHT if not wk else LIGHT, radius=10)
        rect(c, x, top - 34, colw, 16, fill=LIGHT)
        hol = HOLIDAYS.get(d)
        text(c, x + 10, top - 15, DAGEN[i].capitalize(), "Inter-SemiBold", 10, SAGE_DARK)
        text(c, x + 10, top - 27, f"{d.day} {MAANDEN_KORT[d.month - 1]}", "Inter", 8.5, RED if hol in OFFICIAL else GREY)
        text(c, x + colw - 8, top - 15, str(d.day), "Playfair-SemiBold", 15, SAGE_DARK, "right")
        if hol:
            text(c, x + 10, top - 48, hol, "Inter-Medium", 7.5, SAGE)
        ruled(c, x + 10, top - 52, colw - 20, day_h - 60, spacing=19)
    # bottom row
    by = CY0 + bottom_h
    bw = (CX1 - CX0 - 2 * 12) / 3
    for i, (t, kind) in enumerate([("Top 3 prioriteiten", "check"), ("Notities", "lines"), ("Vooruitblik volgende week", "lines")]):
        x = CX0 + i * (bw + 12)
        rect(c, x, CY0, bw, bottom_h, fill=WHITE, stroke=LINE, radius=10)
        text(c, x + 12, by - 18, t, "Inter-SemiBold", 11, SAGE_DARK)
        if kind == "check":
            yy = by - 42
            for _ in range(3):
                checkbox(c, x + 12, yy - 2, size=11)
                hline(c, x + 30, x + bw - 12, yy - 2, color=LINE_SOFT)
                yy -= 30
        else:
            ruled(c, x + 12, by - 24, bw - 24, bottom_h - 30, spacing=20)
    c.showPage()


def notes_pages(c):
    kinds = [("Notities", "lines"), ("Notities", "dots"), ("Notities", "blank")]
    for i, (t, kind) in enumerate(kinds):
        if i == 0:
            c.bookmarkPage("notities")
        chrome(c, "notities")
        text(c, CX0, CY1 - 34, t, "Playfair-SemiBold", 30, DARK)
        text(c, CX1, CY1 - 34, {"lines": "gelinieerd", "dots": "stippen", "blank": "blanco"}[kind], "Inter", 10, GREY, "right")
        hline(c, CX0, CX1, CY1 - 48, color=LINE)
        if kind == "lines":
            ruled(c, CX0, CY1 - 52, CX1 - CX0, CY1 - 52 - CY0, spacing=24, color=LINE)
        elif kind == "dots":
            dots(c, CX0, CY0, CX1 - CX0, CY1 - 56, step=20)
        c.showPage()


def back_cover(c):
    rect(c, 0, 0, W, H, fill=SAGE)
    text(c, W / 2, H / 2 + 30, "Plannerij", "Playfair-SemiBold", 40, WHITE, "center")
    text(c, W / 2, H / 2 - 4, "Rust in je hoofd begint met overzicht.", "Inter", 14, LIGHT, "center")
    text(c, W / 2, 80, "© 2026 Plannerij · Alleen voor persoonlijk gebruik · Niet doorverkopen of delen", "Inter", 9, LIGHT, "center")
    c.showPage()


def build_digital():
    path = os.path.join(OUT, "Plannerij-Digitale-Planner-2027.pdf")
    c = canvas.Canvas(path, pagesize=(W, H))
    c.setTitle("Plannerij Digitale Planner 2027")
    c.setAuthor("Plannerij")
    c.setSubject("Gedateerde digitale planner 2027 voor GoodNotes, Notability en Samsung Notes")
    cover(c)
    index_page(c)
    year_page(c)
    goals_page(c)
    for m_ in range(1, 13):
        month_page(c, m_)
        habit_page(c, m_)
        for wi in weeks_in_month(m_):
            week_page(c, wi)
    # weeks not anchored to a 2027 month (first partial week of the year): ensure every week exists
    done = set()
    for m_ in range(1, 13):
        done.update(weeks_in_month(m_))
    for wi in range(len(WEEKS)):
        if wi not in done:
            week_page(c, wi)
    notes_pages(c)
    back_cover(c)
    c.save()
    return path


# ---------------------------------------------------------------- printable edition (A4 portrait)
PW, PH = A4


def p_header(c, title, sub=None):
    text(c, 40, PH - 60, title, "Playfair-SemiBold", 24, DARK)
    if sub:
        text(c, PW - 40, PH - 60, sub, "Inter", 10, GREY, "right")
    hline(c, 40, PW - 40, PH - 72, color=SAGE, lw=1)
    text(c, 40, 28, "Plannerij · Planner 2027", "Inter", 7.5, GREY)
    text(c, PW - 40, 28, "plannerij.nl", "Inter", 7.5, GREY, "right")


def p_cover(c):
    rect(c, 0, 0, PW, PH, fill=SAND)
    rect(c, 0, PH * 0.42, PW, PH * 0.58, fill=SAGE)
    text(c, 50, PH - 90, "Plannerij", "Playfair-SemiBold", 26, WHITE)
    text(c, 50, PH * 0.42 + 60, "2027", "Playfair-Bold", 130, WHITE)
    text(c, 50, PH * 0.42 - 50, "Printbare planner", "Playfair-SemiBold", 24, DARK)
    y = PH * 0.42 - 90
    for it in ["Jaaroverzicht en doelen", "12 maandpagina's met weeknummers en feestdagen",
               "53 weekpagina's (maandag – zondag)", "Gewoontetracker per maand", "Notitiepagina's"]:
        c.setFillColor(SAGE)
        c.circle(56, y + 3.5, 2.6, stroke=0, fill=1)
        text(c, 68, y, it, "Inter", 11.5, DARK)
        y -= 22
    text(c, 50, 60, "© 2026 Plannerij · Persoonlijk gebruik", "Inter", 8, GREY)
    c.showPage()


def p_year(c):
    p_header(c, "Jaaroverzicht 2027", "Feestdagen NL & BE gemarkeerd")
    gw = (PW - 80 - 2 * 18) / 3
    gh = (PH - 110 - 50 - 3 * 14) / 4
    for m_ in range(12):
        col, row = m_ % 3, m_ // 3
        x = 40 + col * (gw + 18)
        ytop = PH - 92 - row * (gh + 14)
        rect(c, x - 6, ytop - gh + 2, gw + 12, gh, fill=WHITE, stroke=LINE_SOFT, radius=8)
        mini_calendar(c, x, ytop - 6, gw, gh - 22, m_ + 1, link_to_month=False)
    c.showPage()


def p_goals(c):
    p_header(c, "Mijn doelen voor 2027")
    boxw = (PW - 80 - 14) / 2
    boxh = 170
    cats = ["Werk & studie", "Gezondheid & energie", "Geld & sparen", "Relaties & plezier"]
    for i, cat in enumerate(cats):
        col, row = i % 2, i // 2
        x = 40 + col * (boxw + 14)
        ytop = PH - 90 - row * (boxh + 14)
        rect(c, x, ytop - boxh, boxw, boxh, fill=WHITE, stroke=LINE, radius=10)
        text(c, x + 12, ytop - 18, cat, "Inter-SemiBold", 11, SAGE_DARK)
        ruled(c, x + 12, ytop - 24, boxw - 24, boxh - 32, spacing=22)
    y = PH - 90 - 2 * (boxh + 14)
    text(c, 40, y - 10, "Mijn woord voor 2027:", "Inter-SemiBold", 11, SAGE_DARK)
    hline(c, 170, 400, y - 12, color=GREY)
    text(c, 40, y - 40, "Kwartaaldoelen", "Inter-SemiBold", 11, SAGE_DARK)
    qw = (PW - 80 - 3 * 10) / 4
    for q in range(4):
        x = 40 + q * (qw + 10)
        rect(c, x, 50, qw, y - 50 - 52, fill=SAND, radius=8)
        text(c, x + 10, y - 66, f"Q{q + 1}", "Inter-Bold", 10, SAGE)
        ruled(c, x + 10, y - 72, qw - 20, y - 50 - 52 - 30, spacing=20)
    c.showPage()


def p_month(c, month):
    p_header(c, f"{MAANDEN[month - 1].capitalize()} 2027")
    rows = month_grid(month)
    gx0, gx1 = 40, PW - 40
    gy1 = PH - 92
    wkcol = 24
    colw = (gx1 - gx0 - wkcol) / 7
    rowh = 62
    for i, dn in enumerate(DAGEN_KORT):
        text(c, gx0 + wkcol + colw * i + colw / 2, gy1 - 10, dn, "Inter-Medium", 8, GREY, "center")
    for r, row in enumerate(rows):
        ytop = gy1 - 16 - r * rowh
        iso = row[0].isocalendar()[1]
        text(c, gx0 + wkcol / 2 - 2, ytop - rowh / 2 - 3, str(iso), "Inter-SemiBold", 8, SAGE, "center")
        for i, d in enumerate(row):
            x = gx0 + wkcol + colw * i
            inm = d.month == month
            rect(c, x, ytop - rowh, colw, rowh, fill=WHITE if inm else SAND, stroke=LINE_SOFT)
            if inm:
                hol = HOLIDAYS.get(d)
                col = RED if (d.weekday() == 6 or hol in OFFICIAL) else DARK
                text(c, x + 5, ytop - 12, str(d.day), "Inter-SemiBold", 9, col)
                if hol:
                    label = hol if len(hol) <= 18 else hol[:17] + "…"
                    text(c, x + 5, ytop - 22, label, "Inter", 5.8, SAGE_DARK)
    y = gy1 - 16 - len(rows) * rowh - 16
    third = (gx1 - gx0 - 20) / 3
    for i, t in enumerate(["Focus deze maand", "Belangrijke data", "Te doen"]):
        x = gx0 + i * (third + 10)
        rect(c, x, 44, third, y - 44, fill=WHITE, stroke=LINE, radius=8)
        text(c, x + 10, y - 16, t, "Inter-SemiBold", 10, SAGE_DARK)
        if t == "Te doen":
            yy = y - 36
            while yy > 54:
                checkbox(c, x + 10, yy - 2, size=8)
                hline(c, x + 24, x + third - 10, yy - 2, color=LINE_SOFT)
                yy -= 18
        else:
            ruled(c, x + 10, y - 22, third - 20, y - 44 - 30, spacing=18)
    c.showPage()


def p_habits(c, month):
    p_header(c, f"Gewoontetracker · {MAANDEN[month - 1]}", "Kleur een bolletje per dag")
    ndays = (dt.date(2027, month % 12 + 1, 1) - dt.timedelta(days=1)).day if month < 12 else 31
    labelw = 150
    x0, x1 = 40, PW - 40
    gy1 = PH - 92
    colw = (x1 - x0 - labelw) / 31
    nrows = 10
    rowh = 24
    for d in range(ndays):
        date = dt.date(2027, month, d + 1)
        cx = x0 + labelw + colw * d + colw / 2
        if date.weekday() >= 5:
            rect(c, x0 + labelw + colw * d, gy1 - 24 - nrows * rowh, colw, nrows * rowh + 24, fill=SAND)
        text(c, cx, gy1 - 9, DAGEN_KORT[date.weekday()][0].upper(), "Inter", 6, GREY, "center")
        text(c, cx, gy1 - 19, str(d + 1), "Inter-Medium", 6.5, DARK, "center")
    for r in range(nrows):
        ytop = gy1 - 24 - r * rowh
        hline(c, x0, x1, ytop - rowh, color=LINE_SOFT)
        for d in range(ndays):
            cx = x0 + labelw + colw * d + colw / 2
            circle_box(c, cx, ytop - rowh / 2, r=3.6)
    hline(c, x0, x1, gy1 - 24, color=LINE)
    text(c, x0, gy1 - 17, "Gewoonte", "Inter-SemiBold", 8, GREY)
    by = gy1 - 24 - nrows * rowh - 24
    rect(c, x0, 44, x1 - x0, by - 44, fill=WHITE, stroke=LINE, radius=8)
    text(c, x0 + 10, by - 16, "Reflectie op deze maand", "Inter-SemiBold", 10, SAGE_DARK)
    third = (x1 - x0 - 20) / 3
    for i, lbl in enumerate(["Wat ging goed", "Wat kan beter", "Volgende maand"]):
        text(c, x0 + 10 + i * third, by - 32, lbl, "Inter-Medium", 8.5, GREY)
        ruled(c, x0 + 10 + i * third, by - 36, third - 14, by - 44 - 46, spacing=18)
    c.showPage()


def p_week(c, wi):
    iy, iw, monday = WEEKS[wi]
    label = f"Week {iw}" + ("" if iy == 2027 else f" ({iy})")
    p_header(c, label, fmt_range(monday))
    x0, x1 = 40, PW - 40
    top = PH - 90
    colw = (x1 - x0 - 12) / 2
    rowh = (top - 44) / 4
    # left column Mon-Thu, right Fri, Sat, Sun + notes
    slots = [(0, 0, 0), (1, 0, 1), (2, 0, 2), (3, 0, 3), (4, 1, 0), (5, 1, 1), (6, 1, 2)]
    for di, col, row in slots:
        d = monday + dt.timedelta(days=di)
        x = x0 + col * (colw + 12)
        ytop = top - row * rowh
        wk = di >= 5
        rect(c, x, ytop - rowh + 6, colw, rowh - 6, fill=SAND if wk else WHITE, stroke=LINE, radius=8)
        hol = HOLIDAYS.get(d)
        text(c, x + 10, ytop - 14, DAGEN[di].capitalize(), "Inter-SemiBold", 10, SAGE_DARK)
        text(c, x + colw - 10, ytop - 14, f"{d.day} {MAANDEN_KORT[d.month - 1]}", "Inter-Medium", 9,
             RED if hol in OFFICIAL else GREY, "right")
        if hol:
            text(c, x + 10, ytop - 26, hol, "Inter", 7.5, SAGE)
        ruled(c, x + 10, ytop - 30, colw - 20, rowh - 44, spacing=17)
    # notes box bottom-right
    x = x0 + colw + 12
    ytop = top - 3 * rowh
    rect(c, x, 44, colw, ytop - 44 + 6 - 0, fill=WHITE, stroke=LINE, radius=8)
    text(c, x + 10, ytop - 14, "Prioriteiten & notities", "Inter-SemiBold", 10, SAGE_DARK)
    yy = ytop - 34
    for _ in range(3):
        checkbox(c, x + 10, yy - 1, size=9)
        hline(c, x + 26, x + colw - 10, yy - 1, color=LINE_SOFT)
        yy -= 20
    ruled(c, x + 10, yy + 6, colw - 20, yy - 44, spacing=17)
    c.showPage()


def p_notes(c, kind):
    if True:
        p_header(c, "Notities", {"lines": "gelinieerd", "dots": "stippen"}[kind])
        if kind == "lines":
            ruled(c, 40, PH - 84, PW - 80, PH - 84 - 44, spacing=22, color=LINE)
        else:
            dots(c, 40, 44, PW - 80, PH - 84 - 44, step=18)
        c.showPage()


def build_printable(pagesize, name):
    global PW, PH
    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=pagesize)
    c.setTitle("Plannerij Printbare Planner 2027")
    c.setAuthor("Plannerij")
    scale = pagesize[0] / A4[0]
    PW, PH = A4

    def page_fn(fn, *a):
        c.scale(scale, scale)
        fn(c, *a)

    # showPage is called inside fn; scale must be re-applied per page → wrap each drawing
    page_fn(p_cover)
    page_fn(p_year)
    page_fn(p_goals)
    for m_ in range(1, 13):
        page_fn(p_month, m_)
        page_fn(p_habits, m_)
        for wi in weeks_in_month(m_):
            page_fn(p_week, wi)
    done = set()
    for m_ in range(1, 13):
        done.update(weeks_in_month(m_))
    for wi in range(len(WEEKS)):
        if wi not in done:
            page_fn(p_week, wi)
    page_fn(p_notes, "lines")
    page_fn(p_notes, "dots")
    c.save()
    return path


if __name__ == "__main__":
    print(build_digital())
    print(build_printable(A4, "Plannerij-Printbare-Planner-2027-A4.pdf"))
    print(build_printable(A5, "Plannerij-Printbare-Planner-2027-A5.pdf"))
    print("weeks:", len(WEEKS), [(w[0], w[1]) for w in WEEKS[:3]], WEEKS[-1][:2])
