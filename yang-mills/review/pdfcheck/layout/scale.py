import sys, re, logging
logging.disable(logging.CRITICAL)
import pdfplumber
pdf = pdfplumber.open(sys.argv[1])
res = []
for i, page in enumerate(pdf.pages, 1):
    words = page.extract_words(keep_blank_chars=False)
    foot = [w for w in words if w['top'] > 800]
    if not foot:
        print(i, 'no footer'); continue
    x0 = min(w['x0'] for w in foot); x1 = max(w['x1'] for w in foot)
    pag = [w for w in foot if w['text'] == 'pagina']
    wpag = pag[0]['x1'] - pag[0]['x0'] if pag else None
    body = [w for w in words if w['top'] <= 800]
    bx0 = min(w['x0'] for w in body) if body else None
    bx1 = max(w['x1'] for w in body) if body else None
    by1 = max(w['bottom'] for w in body) if body else None
    txt = ' '.join(w['text'] for w in foot)
    res.append((i, x0, x1, wpag, bx0, bx1, by1, txt[-18:]))
for r in res:
    print("p%2d footer x %.1f..%.1f  'pagina' w=%.2f  body x %.1f..%.1f  bottom %.1f  %s" % r)
