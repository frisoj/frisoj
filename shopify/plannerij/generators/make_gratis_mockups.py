"""Productafbeeldingen (1600x1600) voor de gratis weggever.

Bewust ZONDER ingebakken producttitel of merknaam: het Shopify-thema zet er zelf
koppen overheen. Alleen de PDF-pagina's in een rustige merk-achtergrond.

    python3 make_gratis_mockups.py

Schrijft naar ../afbeeldingen/gratis-*.png
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import mockups  # noqa: E402

OUT = os.path.abspath(os.path.join(HERE, "..", "afbeeldingen"))
os.makedirs(OUT, exist_ok=True)
mockups.OUT = OUT  # save() schrijft standaard naar een scratch-map

from mockups import base, render_page, shadow_paste, save  # noqa: E402

PDF = os.path.abspath(os.path.join(HERE, "..", "producten",
                                   "Plannerij-Gratis-Weekplanner-A4.pdf"))


def hero():
    im = base()
    shadow_paste(im, render_page(PDF, 1, 720), (740, 300), angle=6)
    shadow_paste(im, render_page(PDF, 0, 720), (200, 380), angle=-3)
    save(im, "gratis-1-hero")


def single(page, name):
    im = base(blob=False)
    shadow_paste(im, render_page(PDF, page, 1000), (300, 95), radius=20)
    save(im, name)


def grid():
    im = base()
    w = 500
    for i, (x, y) in enumerate([(200, 60), (900, 60), (200, 830), (900, 830)]):
        shadow_paste(im, render_page(PDF, i, w), (x, y), radius=14, blur=18,
                     offset=(0, 14), alpha=75)
    save(im, "gratis-4-alle-paginas")


if __name__ == "__main__":
    hero()
    single(0, "gratis-2-weekplanner")
    single(1, "gratis-3-gewoontetracker")
    grid()
