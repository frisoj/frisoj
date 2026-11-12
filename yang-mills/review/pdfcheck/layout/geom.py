import sys, logging
logging.disable(logging.CRITICAL)
import pdfplumber
pdf = pdfplumber.open(sys.argv[1])
L, R, T, B = 42.5, 595.92 - 42.5, 42.5, 842.88 - 48.2     # 15 mm left/right/top, 17 mm bottom
n_img = 0; out_img = []; overl = []; out_words = []; small = []
for i, page in enumerate(pdf.pages, 1):
    for im in page.images:
        n_img += 1
        if im['x0'] < L - 1 or im['x1'] > R + 1 or im['top'] < T - 1 or im['bottom'] > B + 1:
            out_img.append((i, round(im['x0']), round(im['x1']), round(im['top']), round(im['bottom'])))
    words = [w for w in page.extract_words(extra_attrs=['size']) if w['top'] < 800]
    for w in words:
        if w['x0'] < L - 1 or w['x1'] > R + 1 or w['top'] < T - 3 or w['bottom'] > B + 1:
            out_words.append((i, w['text'], round(w['x0'], 1), round(w['x1'], 1), round(w['bottom'], 1)))
        if w['size'] < 6.0: small.append((i, round(w['size'], 2), w['text']))
    # overlapping words: boxes intersecting by more than 30 % of the smaller height and 1.5 pt horizontally
    ws = sorted(words, key=lambda w: w['top'])
    for a_i, a in enumerate(ws):
        for b in ws[a_i + 1:]:
            if b['top'] > a['bottom']: break
            ox = min(a['x1'], b['x1']) - max(a['x0'], b['x0'])
            oy = min(a['bottom'], b['bottom']) - max(a['top'], b['top'])
            hmin = min(a['bottom'] - a['top'], b['bottom'] - b['top'])
            if ox > 1.5 and oy > 0.3 * hmin:
                overl.append((i, a['text'], b['text'], round(ox, 1), round(oy, 1)))
print("images:", n_img, "outside the type area:", out_img)
print("words outside the type area:", len(out_words), out_words[:10])
print("overlapping word boxes:", len(overl)); [print("  ", o) for o in overl[:25]]
import collections
print("body words smaller than 6 pt:", len(small), collections.Counter((s[0], s[1]) for s in small).most_common(12))
