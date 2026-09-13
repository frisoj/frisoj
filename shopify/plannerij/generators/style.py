"""Shared Plannerij style helpers for reportlab canvases."""
import os
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor

FONT_DIR = "/tmp/claude-0/-home-user-frisoj/b2406013-c3ca-5da6-8b93-0de4c5b2366a/scratchpad/build/fonts"

SAGE = HexColor("#5F7A61")
SAGE_DARK = HexColor("#465C48")
LIGHT = HexColor("#E8EFE6")
SAND = HexColor("#F4EFE6")
DARK = HexColor("#1F2A24")
GREY = HexColor("#8A8F8B")
LINE = HexColor("#D9D9D9")
LINE_SOFT = HexColor("#ECECEC")
WHITE = HexColor("#FFFFFF")
RED = HexColor("#B5482B")

_registered = False


def register_fonts():
    global _registered
    if _registered:
        return
    fonts = {
        "Inter": "Inter-400.ttf",
        "Inter-Medium": "Inter-500.ttf",
        "Inter-SemiBold": "Inter-600.ttf",
        "Inter-Bold": "Inter-700.ttf",
        "Playfair": "PlayfairDisplay-400.ttf",
        "Playfair-SemiBold": "PlayfairDisplay-600.ttf",
        "Playfair-Bold": "PlayfairDisplay-700.ttf",
    }
    for name, fn in fonts.items():
        pdfmetrics.registerFont(TTFont(name, os.path.join(FONT_DIR, fn)))
    _registered = True


def text(c, x, y, s, font="Inter", size=10, color=DARK, align="left"):
    c.setFont(font, size)
    c.setFillColor(color)
    if align == "left":
        c.drawString(x, y, s)
    elif align == "right":
        c.drawRightString(x, y, s)
    else:
        c.drawCentredString(x, y, s)


def rect(c, x, y, w, h, fill=None, stroke=None, radius=0, lw=0.6):
    if fill is not None:
        c.setFillColor(fill)
    if stroke is not None:
        c.setStrokeColor(stroke)
        c.setLineWidth(lw)
    if radius:
        c.roundRect(x, y, w, h, radius, stroke=1 if stroke is not None else 0, fill=1 if fill is not None else 0)
    else:
        c.rect(x, y, w, h, stroke=1 if stroke is not None else 0, fill=1 if fill is not None else 0)


def hline(c, x1, x2, y, color=LINE, lw=0.5, dash=None):
    c.setStrokeColor(color)
    c.setLineWidth(lw)
    if dash:
        c.setDash(dash)
    c.line(x1, y, x2, y)
    if dash:
        c.setDash()


def vline(c, x, y1, y2, color=LINE, lw=0.5):
    c.setStrokeColor(color)
    c.setLineWidth(lw)
    c.line(x, y1, x, y2)


def ruled(c, x, y_top, w, h, spacing=18, color=LINE_SOFT, dotted=False):
    """Draw writing lines from y_top downwards within height h."""
    y = y_top - spacing
    while y > y_top - h + 2:
        hline(c, x, x + w, y, color=color, lw=0.5, dash=(1, 3) if dotted else None)
        y -= spacing


def dots(c, x, y, w, h, step=14, color=LINE):
    c.setFillColor(color)
    yy = y + h - step
    while yy > y:
        xx = x + step
        while xx < x + w:
            c.circle(xx, yy, 0.6, stroke=0, fill=1)
            xx += step
        yy -= step


def checkbox(c, x, y, size=9, color=LINE):
    rect(c, x, y, size, size, stroke=color, radius=2, lw=0.7)


def circle_box(c, x, y, r=4.2, color=LINE):
    c.setStrokeColor(color)
    c.setLineWidth(0.6)
    c.circle(x, y, r, stroke=1, fill=0)


def link(c, dest, x, y, w, h):
    c.linkRect("", dest, (x, y, x + w, y + h), relative=0, thickness=0)
