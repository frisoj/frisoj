#!/usr/bin/env python3
"""Appendix B figures (p. 29-41): the two images on each analysis page against results/<ens>_glueball_meff.png (left)
and results/<ens>_torelon_meff.png (right), pixel by pixel; and the report figures (p. 6-27) against the PNG files
named in REPORT.md."""
import io, re, logging, os
logging.disable(logging.CRITICAL)
import numpy as np
from PIL import Image
from pypdf import PdfReader
import pdfplumber
QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
ROOT = "/home/user/frisoj/yang-mills"
ENS = ["d3_b6.0_L16", "d3_b6.0_L24", "d3_b9.0_L24", "d3_b9.0_L24r", "d3_b9.0_L24_combined", "d3_b12.0_L32", "d4_b2.3_L10",
       "d4_b2.4_L12", "d4_b2.4_L16", "d4_b2.5_L16", "d4_b2.5_L16x", "d4_b2.5_L16_combined", "d4_b2.5_L20"]
r = PdfReader(QA + "/REPORT_v4.pdf")
def rgb(img):
    im = img.convert("RGBA"); bg = Image.new("RGBA", im.size, (255, 255, 255, 255)); bg.alpha_composite(im)
    return np.asarray(bg.convert("RGB")).astype(int)
def page_images(pno):
    """images of a page with their x position (pdfplumber), in left-to-right order, as RGB arrays (pypdf)."""
    with pdfplumber.open(QA + "/REPORT_v4.pdf") as pdf:
        geo = sorted(((im["x0"], im["top"], im["name"]) for im in pdf.pages[pno - 1].images))
    imgs = {i.name.split(".")[0].lstrip("/"): i for i in r.pages[pno - 1].images}
    out = []
    for x0, top, name in geo:
        key = [k for k in imgs if k == name or k.endswith(name)]
        out.append((x0, top, rgb(imgs[key[0]].image) if key else None))
    return out
ok = bad = 0
for k, e in enumerate(ENS):
    pno = 29 + k
    txt = r.pages[pno - 1].extract_text()
    assert txt.lstrip().startswith(e + ":"), (pno, txt[:40])
    pi = page_images(pno)
    exp = [rgb(Image.open(f"{ROOT}/results/{e}_{s}.png")) for s in ("glueball_meff", "torelon_meff")]
    res = []
    for (x0, top, arr), ref in zip(pi, exp):
        same = arr is not None and arr.shape == ref.shape and int(np.abs(arr - ref).max()) == 0
        res.append(same); ok += same; bad += (not same)
    if len(pi) != 2: bad += 1
    print("p.%d %-22s images on page: %d; left = glueball_meff.png: %s; right = torelon_meff.png: %s; left x0 %.0f < right x0 %.0f"
          % (pno, e, len(pi), res[0] if res else None, res[1] if len(res) > 1 else None, pi[0][0], pi[1][0]))
print("appendix B figures pixel-identical to the PNG files: %d of %d" % (ok, 2 * len(ENS)))
# report figures: PNG files referenced in REPORT.md, in order, against the raster images of p. 6-27 in order
md = open(ROOT + "/REPORT.md", encoding="utf-8").read()
refs = re.findall(r"!\[[^\]]*\]\(([^)]+\.png)\)", md)
found = []
for pno in range(6, 28):
    for x0, top, arr in sorted(page_images(pno), key=lambda t: (round(t[1]), t[0])):
        found.append((pno, arr))
print("PNG figures referenced in REPORT.md: %d; raster images on p. 6-27: %d" % (len(refs), len(found)))
okr = 0
for ref, (pno, arr) in zip(refs, found):
    a = rgb(Image.open(os.path.join(ROOT, ref)))
    same = arr is not None and arr.shape == a.shape and int(np.abs(arr - a).max()) == 0
    okr += same
    print("   %-45s p.%d  identical: %s" % (ref, pno, same))
print("report figures pixel-identical: %d of %d" % (okr, len(refs)))
print("TOTAL figure problems:", bad + (len(refs) - okr) + abs(len(refs) - len(found)))
