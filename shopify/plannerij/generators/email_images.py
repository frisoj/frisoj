"""Header images for the Plannerij e-mail campaigns (Shopify Email).

Shopify Email shows a banner at the top of a campaign at roughly 600 points wide.
These are rendered at 1200x600 (2x, 2:1) so they stay sharp on retina screens, and
at 1200x400 (3:1) for the slimmer product headers.

The wording comes straight from marketing/04-email.md; nothing here invents a new
claim. Text is drawn on an empty half of the canvas so it never lands on a render.

Run: python3 email_images.py   ->  afbeeldingen/email/
"""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import mockups  # noqa: E402

mockups.FONTS = f"{HERE}/fonts"
from mockups import (SAND, SAGE, SAGE_DARK, LIGHT, DARK, GREY, WHITE,  # noqa: E402
                     font, render_page, shadow_paste, tablet_frame, sheet_image)

OUT = f"{ROOT}/afbeeldingen/email"
os.makedirs(OUT, exist_ok=True)

PROD = f"{ROOT}/producten"
PL = f"{PROD}/Plannerij-Digitale-Planner-2027.pdf"
PA4 = f"{PROD}/Plannerij-Printbare-Planner-2027-A4.pdf"
PB = f"{PROD}/Plannerij-Printable-Bundel-A4.pdf"
PR = f"{PROD}/Plannerij-AI-Prompt-Pack.pdf"
XLSX = f"{PROD}/Plannerij-Budgetplanner.xlsx"


def wrap(d, s, f, max_w):
    words, lines, line = s.split(), [], ""
    for w in words:
        trial = f"{line} {w}".strip()
        if d.textlength(trial, font=f) <= max_w or not line:
            line = trial
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def canvas(w, h, bg=SAND, tint=LIGHT):
    im = Image.new("RGBA", (w, h), bg + (255,))
    d = ImageDraw.Draw(im)
    d.ellipse((w * 0.58, -h * 0.55, w * 1.18, h * 0.78), fill=tint + (255,))
    d.ellipse((-w * 0.10, h * 0.60, w * 0.22, h * 1.55), fill=tint + (255,))
    return im


def headline(im, title, sub=None, box=None, on_dark=False):
    """Draw the wordmark, a title and an optional subline inside `box`."""
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = box
    max_w = x1 - x0

    pill_w, pill_h = 176, 44
    d.rounded_rectangle((x0, y0, x0 + pill_w, y0 + pill_h), radius=22,
                        fill=WHITE if on_dark else SAGE)
    d.text((x0 + pill_w / 2, y0 + pill_h / 2), "Plannerij",
           font=font("PlayfairDisplay-600", 25), fill=SAGE_DARK if on_dark else WHITE, anchor="mm")

    size = 58
    while size > 26:
        f = font("PlayfairDisplay-700", size)
        lines = wrap(d, title, f, max_w)
        fs = font("Inter-400", max(20, int(size * 0.42)))
        subs = wrap(d, sub, fs, max_w) if sub else []
        need = len(lines) * size * 1.16 + (len(subs) * size * 0.42 * 1.35 + 18 if subs else 0)
        if y0 + pill_h + 34 + need <= y1:
            break
        size -= 2

    y = y0 + pill_h + 34
    for ln in lines:
        d.text((x0, y), ln, font=f, fill=WHITE if on_dark else DARK)
        y += size * 1.16
    if subs:
        y += 18
        for ln in subs:
            d.text((x0, y), ln, font=fs, fill=LIGHT if on_dark else GREY)
            y += size * 0.42 * 1.35
    assert y <= y1 + 2, f"tekst loopt buiten het kader: {title}"


def save(im, name):
    path = f"{OUT}/{name}.png"
    im.convert("RGB").save(path, optimize=True)
    print(path, im.size)


# ----------------------------------------------------------------- banners
def welkom():
    im = canvas(1200, 600, bg=SAGE, tint=SAGE_DARK)
    shadow_paste(im, tablet_frame(render_page(PL, 6, 620), bezel=24, radius=40),
                 (700, 120), angle=-4, blur=30, alpha=90)
    shadow_paste(im, render_page(PA4, 3, 250), (620, 330), angle=8, blur=22, alpha=70)
    headline(im, "Welkom bij Plannerij", "Rust in je hoofd begint met overzicht.",
             box=(70, 110, 560, 500), on_dark=True)
    save(im, "mail-welkom-1")


def welkom2():
    im = canvas(1200, 600)
    shadow_paste(im, render_page(PL, 4, 420), (700, 150), angle=-5, blur=26, alpha=70)
    shadow_paste(im, sheet_image(XLSX, "Jaaroverzicht", 420, 20, 7), (930, 250), angle=6,
                 radius=12, blur=24, alpha=65)
    headline(im, "Zo plan je je week in drie minuten",
             "Drie prioriteiten, twee gewoontes, klaar.",
             box=(70, 110, 600, 500))
    save(im, "mail-welkom-2")


def welkom3():
    im = canvas(1200, 600)
    shadow_paste(im, render_page(PB, 1, 300), (760, 140), angle=-6, blur=22, alpha=65)
    shadow_paste(im, render_page(PR, 5, 300), (960, 230), angle=7, blur=22, alpha=65)
    headline(im, "Alles van Plannerij op een rij",
             "Planner, budget, prompts en printables.",
             box=(70, 110, 640, 500))
    save(im, "mail-welkom-3")


def winkelwagen():
    im = canvas(1200, 600)
    shadow_paste(im, tablet_frame(render_page(PL, 6, 500), bezel=22, radius=36),
                 (760, 130), angle=-3, blur=28, alpha=80)
    headline(im, "Je winkelwagen staat nog klaar",
             "Je bestanden zijn direct te downloaden.",
             box=(70, 120, 640, 490))
    save(im, "mail-verlaten-winkelwagen")


def lancering():
    im = canvas(1200, 600, bg=SAGE, tint=SAGE_DARK)
    shadow_paste(im, render_page(PL, 4, 330), (690, 120), angle=-6, blur=24, alpha=80)
    shadow_paste(im, sheet_image(XLSX, "Januari", 330, 18, 7), (900, 180), angle=5,
                 radius=12, blur=24, alpha=75)
    shadow_paste(im, render_page(PB, 3, 250), (760, 350), angle=4, blur=20, alpha=70)
    shadow_paste(im, render_page(PR, 4, 250), (980, 390), angle=-7, blur=20, alpha=70)
    headline(im, "De winkel is open", "Vijf Nederlandse downloads, direct te gebruiken.",
             box=(70, 110, 600, 500), on_dark=True)
    save(im, "mail-lancering")


def najaar():
    im = canvas(1200, 600)
    shadow_paste(im, render_page(PL, 2, 460), (720, 120), angle=-4, blur=26, alpha=70)
    shadow_paste(im, render_page(PL, 4, 380), (950, 260), angle=7, blur=24, alpha=65)
    headline(im, "2027 begint eerder dan je denkt",
             "Zet je jaar nu al op een rustige manier klaar.",
             box=(70, 110, 620, 500))
    save(im, "mail-2027")


def gratis():
    im = canvas(1200, 600)
    shadow_paste(im, render_page(PB, 1, 330), (740, 110), angle=-6, blur=24, alpha=70)
    shadow_paste(im, render_page(PB, 2, 330), (960, 210), angle=6, blur=24, alpha=70)
    headline(im, "Gratis weekplanner + gewoontetracker",
             "Printen en invullen, zonder kosten.",
             box=(70, 110, 620, 500))
    save(im, "mail-gratis-weekplanner")


# --------------------------------------------------- per product (3:1 slim)
def product_headers():
    specs = [
        ("mail-product-planner", "Je Digitale Planner 2027", "Zo zet je hem op je tablet",
         lambda im: (shadow_paste(im, tablet_frame(render_page(PL, 6, 380), bezel=18, radius=30),
                                  (800, 40), angle=-3, blur=22, alpha=75),)),
        ("mail-product-budget", "Je Budgetplanner", "Zo vul je hem in, in vijf minuten",
         lambda im: (shadow_paste(im, sheet_image(XLSX, "Jaaroverzicht", 400, 18, 7), (800, 70),
                                  angle=-3, radius=12, blur=22, alpha=70),)),
        ("mail-product-prompts", "Je AI Prompt Pack", "200 Nederlandse prompts, zo te gebruiken",
         lambda im: (shadow_paste(im, render_page(PR, 5, 240), (820, 40), angle=-5, blur=20, alpha=65),
                     shadow_paste(im, render_page(PR, 12, 240), (1000, 100), angle=6, blur=20, alpha=65))),
        ("mail-product-printables", "Je Printable Bundel", "Printen op A4 of A5",
         lambda im: (shadow_paste(im, render_page(PB, 1, 230), (820, 40), angle=-6, blur=20, alpha=65),
                     shadow_paste(im, render_page(PB, 4, 230), (1000, 110), angle=6, blur=20, alpha=65))),
        ("mail-product-bundel", "Je Complete Bundel 2027", "Alles staat in één zip-bestand",
         lambda im: (shadow_paste(im, render_page(PL, 4, 220), (790, 40), angle=-5, blur=18, alpha=65),
                     shadow_paste(im, sheet_image(XLSX, "Januari", 220, 14, 6), (950, 90), angle=5,
                                  radius=10, blur=18, alpha=65),
                     shadow_paste(im, render_page(PB, 3, 180), (1080, 170), angle=8, blur=16, alpha=60))),
    ]
    for name, title, sub, draw in specs:
        im = canvas(1200, 400)
        draw(im)
        headline(im, title, sub, box=(70, 70, 700, 340))
        save(im, name)


if __name__ == "__main__":
    welkom()
    welkom2()
    welkom3()
    winkelwagen()
    lancering()
    najaar()
    gratis()
    product_headers()
