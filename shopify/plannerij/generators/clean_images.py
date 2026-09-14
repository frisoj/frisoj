"""Text-free brand images for the Plannerij storefront.

The first batch of mockups had the brand name, product title and a badge baked
into the artwork. On the storefront the theme puts its own headings on top of or
next to those images, so the same words appeared twice. These versions carry the
composition only; all wording comes from the theme.

Outputs to <scratchpad>/img-clean/. Filenames match the originals where the file
is replaced in Shopify Files (hero-banner, *-1-hero) plus four collection images.
"""
import os
import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mockups import (SAND, SAGE, SAGE_DARK, LIGHT, WHITE, render_page, shadow_paste,  # noqa: E402
                     tablet_frame, sheet_image, BASE, PL, PA4, PB, PR)

OUT = f"{BASE}/img-clean"
os.makedirs(OUT, exist_ok=True)
XLSX = f"{BASE}/out/budget/Plannerij-Budgetplanner.xlsx"


def canvas(w, h, bg=SAND, shapes=True, dark_blob=False):
    im = Image.new("RGBA", (w, h), bg + (255,))
    if shapes:
        d = ImageDraw.Draw(im)
        tint = SAGE_DARK if dark_blob else LIGHT
        d.ellipse((w * 0.52, -h * 0.35, w * 1.25, h * 0.62), fill=tint + (255,))
        d.ellipse((-w * 0.18, h * 0.62, w * 0.30, h * 1.35), fill=tint + (255,))
    return im


def save(im, name):
    path = f"{OUT}/{name}"
    im.convert("RGB").save(path, optimize=True)
    print(path, im.size)
    return path


# ---------------------------------------------------------------- storefront hero
def hero_banner():
    """2400x1200. Composition on the right; the left half stays empty for the theme's
    heading and buttons, which sit bottom-left in the Horizon hero."""
    w, h = 2400, 1200
    im = canvas(w, h, bg=SAGE, dark_blob=True)
    d = ImageDraw.Draw(im)
    d.ellipse((w * 0.60, h * 0.05, w * 0.60 + 620, h * 0.05 + 620), fill=SAGE_DARK + (255,))
    month = render_page(PL, 4, 1180)
    week = render_page(PL, 6, 1420)
    shadow_paste(im, month, (int(w * 0.78), int(h * 0.30)), angle=-6, blur=34, alpha=80)
    shadow_paste(im, tablet_frame(week, bezel=38, radius=58), (int(w * 0.50), int(h * 0.20)),
                 angle=-3, blur=40, alpha=95)
    printed = render_page(PA4, 5, 430)
    shadow_paste(im, printed, (int(w * 0.42), int(h * 0.62)), angle=7, blur=26, alpha=75)
    return save(im, "hero-banner.png")


# ---------------------------------------------------------------- product / section heroes
def planner_hero():
    im = canvas(1600, 1600)
    week = render_page(PL, 6, 1180)
    year = render_page(PL, 2, 1050)
    shadow_paste(im, year, (620, 300), angle=7)
    shadow_paste(im, render_page(PL, 4, 1050), (330, 420), angle=-4)
    shadow_paste(im, tablet_frame(week), (150, 640))
    return save(im, "planner-1-hero.png")


def budget_hero():
    im = canvas(1600, 1600)
    jaar = sheet_image(XLSX, "Jaaroverzicht", 1180, 30, 9)
    jan = sheet_image(XLSX, "Januari", 1050, 28, 8)
    shadow_paste(im, jan, (620, 340), angle=6, radius=14)
    shadow_paste(im, jaar, (200, 560), angle=-3, radius=14)
    return save(im, "budget-1-hero.png")


def prompts_hero():
    im = canvas(1600, 1600)
    doc = pymupdf.open(PR)
    n = doc.page_count
    for pg, xy, ang in [(0, (880, 330), 8), (min(5, n - 1), (520, 470), -6), (min(12, n - 1), (170, 640), 3)]:
        shadow_paste(im, render_page(PR, pg, 700), xy, angle=ang)
    return save(im, "prompts-1-hero.png")


def printables_hero():
    im = canvas(1600, 1600)
    for pg, xy, ang in [(1, (900, 330), 8), (3, (540, 470), -6), (4, (180, 640), 3)]:
        shadow_paste(im, render_page(PB, pg, 700), xy, angle=ang)
    return save(im, "printables-1-hero.png")


def bundel_hero():
    im = canvas(1600, 1600)
    shadow_paste(im, render_page(PL, 4, 860), (90, 430), angle=-5)
    shadow_paste(im, sheet_image(XLSX, "Jaaroverzicht", 720, 22, 8), (430, 900), angle=3, radius=14)
    shadow_paste(im, render_page(PB, 3, 430), (1050, 420), angle=6)
    shadow_paste(im, render_page(PR, 4, 430), (830, 880), angle=-7)
    return save(im, "bundel-1-hero.png")


# ---------------------------------------------------------------- collection cards
def collections():
    specs = [
        ("collectie-planners.png", lambda im: (
            shadow_paste(im, render_page(PL, 4, 900), (520, 300), angle=6),
            shadow_paste(im, tablet_frame(render_page(PL, 6, 980), bezel=32, radius=48), (120, 520), angle=-2))),
        ("collectie-budget.png", lambda im: (
            shadow_paste(im, sheet_image(XLSX, "Januari", 880, 26, 8), (560, 320), angle=6, radius=14),
            shadow_paste(im, sheet_image(XLSX, "Jaaroverzicht", 980, 26, 8), (140, 560), angle=-3, radius=14))),
        ("collectie-ai.png", lambda im: (
            shadow_paste(im, render_page(PR, 5, 620), (640, 320), angle=7),
            shadow_paste(im, render_page(PR, 12, 700), (200, 520), angle=-4))),
        ("collectie-bundels.png", lambda im: (
            shadow_paste(im, render_page(PL, 6, 760), (140, 380), angle=-4),
            shadow_paste(im, sheet_image(XLSX, "Jaaroverzicht", 600, 20, 7), (520, 760), angle=4, radius=12),
            shadow_paste(im, render_page(PB, 3, 400), (900, 360), angle=7),
            shadow_paste(im, render_page(PR, 4, 380), (820, 800), angle=-6))),
    ]
    for name, draw in specs:
        im = canvas(1400, 1400)
        draw(im)
        save(im, name)


if __name__ == "__main__":
    hero_banner()
    planner_hero()
    budget_hero()
    prompts_hero()
    printables_hero()
    bundel_hero()
    collections()
