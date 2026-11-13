#!/usr/bin/env python3
"""v2, task 5: the page number printed for each entry of the contents page (p. 2) against the page on which
that heading actually stands. Three independent ways to find the heading page:
 (1) pdfplumber: a text line set in the h2 size (about 15 pt) whose text equals the entry;
 (2) the link annotation of the entry on p. 2 -> named destination -> page (pypdf);
 (3) the PDF outline (bookmarks) (pypdf).
Also: the footer 'pagina N van 42' on every page."""
import re, collections, logging, os
logging.disable(logging.CRITICAL)
import pdfplumber
from pypdf import PdfReader
QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
PDF = QA + "/REPORT_v4.pdf"
nbad = 0
nq = lambda s: re.sub(r"\s+", " ", s.replace("ˮ", "”")).strip()
with pdfplumber.open(PDF) as pdf:
    npages = len(pdf.pages)
    # ---- contents entries from page 2: lines between 'Inhoud' and the heading 'Vooraf en leeswijzer'
    p2 = pdf.pages[1]
    lines = p2.extract_text_lines()
    toc = []
    started = False
    for ln in lines:
        t = nq(ln["text"])
        if t == "Inhoud": started = True; continue
        if not started: continue
        m = re.fullmatch(r"(.*\S) (\d+)", t)
        size = round(max(c["size"] for c in ln["chars"]), 1)
        if m and size < 12:
            toc.append((m.group(1), int(m.group(2))))
        else:
            break
    print("contents entries on p. 2:", len(toc))
    # ---- (1) headings by font size
    heads = {}
    sizes = collections.Counter()
    for pno, page in enumerate(pdf.pages, 1):
        for ln in page.extract_text_lines():
            size = round(max(c["size"] for c in ln["chars"]), 1)
            sizes[size] += 1
            if 14.0 <= size <= 16.5:
                heads.setdefault(nq(ln["text"]), []).append(pno)
    # ---- footers
    foot_ok = 0
    for pno, page in enumerate(pdf.pages, 1):
        t = nq(page.extract_text() or "")
        if re.search(r"pagina %d van %d$" % (pno, npages), t): foot_ok += 1
        else: print("MISMATCH footer on page", pno, repr(t[-60:])); nbad += 1
print("lines set at 14-16.5 pt (h2 headings) found:", {k: v for k, v in heads.items()})
r = PdfReader(PDF)
# ---- (2) link annotations on page 2
dests = r.named_destinations
links = []
for a in r.pages[1].get("/Annots", []) or []:
    a = a.get_object()
    if a.get("/Subtype") != "/Link": continue
    d = a.get("/Dest")
    if d is None and "/A" in a: d = a["/A"].get("/D")
    name = str(d) if not isinstance(d, list) else None
    pg = None
    if name is not None and name.lstrip("/") in {k.lstrip("/") for k in dests}:
        key = [k for k in dests if k.lstrip("/") == name.lstrip("/")][0]
        pg = r.get_destination_page_number(dests[key]) + 1
    elif isinstance(d, list):
        pg = r.get_page_number(d[0].get_object()) + 1
    rect = [float(x) for x in a["/Rect"]]
    links.append((round(rect[3], 1), name, pg))
links.sort(key=lambda x: -x[0])     # top of the page first
print("link annotations on p. 2:", len(links))
# ---- (3) outline
outline = []
def walk(items, depth=0):
    for it in items:
        if isinstance(it, list): walk(it, depth + 1)
        else: outline.append((depth, nq(it.title), r.get_destination_page_number(it) + 1))
walk(r.outline)
top = [(t, p) for d, t, p in outline if d == min(x[0] for x in outline)]
print("outline entries: %d (top level %d)" % (len(outline), len(top)))
print()
print("%-58s %7s %9s %9s %9s" % ("entry", "printed", "heading", "link", "outline"))
for i, (title, printed) in enumerate(toc):
    hp = heads.get(title, [])
    hp_body = [p for p in hp if True]
    lk = links[i][2] if i < len(links) else None
    ol = [p for t, p in top if t == title]
    good = (hp_body == [printed]) and lk == printed and ol == [printed]
    if not good: nbad += 1
    print("%-58s %7d %9s %9s %9s  %s" % (title[:58], printed, hp_body, lk, ol, "OK" if good else "MISMATCH"))
if len(toc) != 12:
    nbad += 1; print("MISMATCH: expected 12 entries")
h2 = [k for k in heads if k != "Inhoud"]
print()
print("h2 headings in the document (other than 'Inhoud'): %d; all are contents entries: %s; all contents entries are headings: %s"
      % (len(h2), set(h2) <= {t for t, _ in toc}, {t for t, _ in toc} <= set(h2)))
print("page numbers increase:", [p for _, p in toc] == sorted(p for _, p in toc))
print("footer 'pagina N van %d' correct on %d of %d pages" % (npages, foot_ok, npages))
print("TOTAL contents problems:", nbad)
