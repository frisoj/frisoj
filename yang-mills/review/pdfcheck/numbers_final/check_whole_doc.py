#!/usr/bin/env python3
"""v2: the whole PDF text against the assembled source (document_v4.md through pandoc, plus the title page
pdf/build/title.html): every text block verbatim, and the multiset of all digit strings.
Additions on the PDF side that the source cannot contain are generated here and must account for the whole
difference: the page footers, the contents list with page numbers, the numbers of ordered lists, and the table
headers repeated at page breaks."""
import re, collections, subprocess, unicodedata, json, sys
from html.parser import HTMLParser
QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
ROOT = "/home/user/frisoj/yang-mills"
html_doc = subprocess.run(["pandoc", QA + "/document_v4.md", "-f", "gfm", "-t", "html5", "--columns=100000"], capture_output=True, text=True, check=True).stdout
title = open(ROOT + "/pdf/build/title.html", encoding="utf-8").read()
class X(HTMLParser):
    def __init__(s):
        super().__init__(convert_charrefs=True); s.out = []; s.stack = []; s.markers = []; s.blocks = []; s.h2 = []; s.inh2 = False
    def handle_starttag(s, tag, attrs):
        a = dict(attrs)
        if tag == "ol": s.stack.append(["ol", int(a.get("start", 1))])
        elif tag == "ul": s.stack.append(["ul", 0])
        elif tag == "li" and s.stack and s.stack[-1][0] == "ol":
            s.markers.append(str(s.stack[-1][1])); s.stack[-1][1] += 1
        if tag in ("p", "li", "h1", "h2", "h3", "h4", "pre", "td", "th", "blockquote"): s.blocks.append([])
        if tag == "h2": s.inh2 = True; s.h2.append([])
    def handle_endtag(s, tag):
        if tag in ("ol", "ul") and s.stack: s.stack.pop()
        if tag == "h2": s.inh2 = False
    def handle_data(s, d):
        s.out.append(d)
        if s.blocks: s.blocks[-1].append(d)
        if s.inh2: s.h2[-1].append(d)
x = X(); x.feed(title); x.feed(html_doc)
n = lambda t: re.sub(r"\s+", "", unicodedata.normalize("NFC", t).replace(" ", " ").replace("ˮ", "”"))
NUM = re.compile(r"\d+(?:[.,]\d+)*")
src_text = "".join(x.out)
h2 = ["".join(h) for h in x.h2]
frags = json.load(open(QA + "/numbers-v4/pdf_tables.json"))
rep_heads = []
for i, f in enumerate(frags):
    if i and f["has_header"] and frags[i - 1]["page"] == f["page"] - 1 and len(frags[i - 1]["cols"]) == len(f["cols"]):
        prev = [g for g in frags if g["has_header"] and g["page"] == f["page"] - 1 and len(g["cols"]) == len(f["cols"])]
        first_on_page = all(g["page"] != f["page"] for g in frags[:i])
        if prev and first_on_page and [n(c) for c in f["rows"][0]] == [n(c) for c in prev[-1]["rows"][0]]:
            rep_heads.append((f["page"], f["rows"][0]))
print("h2 headings in the source:", len(h2), "| ordered-list items:", len(x.markers), "| repeated table headers:", [(p, len(h)) for p, h in rep_heads])
nbad = 0
for name, fn in (("pdfium", "pdf_pdfium.txt"), ("pypdf", "pdf_pypdf.txt")):
    pages = open(QA + "/numbers-v4/" + fn, encoding="utf-8").read().replace("\r", "").replace("￾", "-").replace("\x02", "-").split("\f")[:42]
    npages = len(pages)
    pdf_text = "\n".join(pages)
    # what the PDF adds
    toc_pages = dict(re.findall(r"^(.+?) (\d+)$", pages[1].split("Vooraf en leeswijzer\n", 2)[0].replace("Inhoud\n", ""), flags=re.M)) if False else None
    add = []
    for p in range(1, npages + 1):
        add.append("Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs pagina %d van %d" % (p, npages))
    # contents: 'Inhoud' + each heading + its page number as printed (the page numbers themselves are checked in check_toc.py)
    toc_block = pages[1][:pages[1].index("\nVooraf en leeswijzer\nDatum")] if "\nVooraf en leeswijzer\nDatum" in pages[1] else pages[1][:pages[1].rindex("Vooraf en leeswijzer")]
    add.append(toc_block)
    add += ["".join(m + "." for m in x.markers)]
    add += [" ".join(" ".join(h) for _, h in rep_heads)]
    add_text = "\n".join(add)
    a = collections.Counter(NUM.findall(src_text)) + collections.Counter(NUM.findall("\n".join(add[:-2]))) + collections.Counter(x.markers) + collections.Counter(NUM.findall(add[-1]))
    b = collections.Counter(NUM.findall(pdf_text))
    d1 = {k: (v, b.get(k, 0)) for k, v in a.items() if b.get(k, 0) != v}
    d2 = {k: (a.get(k, 0), v) for k, v in b.items() if a.get(k, 0) != v}
    print("\n[%s] digit strings: source + generated additions %d occurrences (%d distinct); PDF %d occurrences (%d distinct)" % (name, sum(a.values()), len(a), sum(b.values()), len(b)))
    print("   different counts (source, pdf):", {**d1, **d2})
    nbad += len({**d1, **d2})
    # contents block must be exactly 'Inhoud' + the 12 headings with a number
    toc_lines = [l for l in toc_block.split("\n") if l.strip()]
    ok_toc = toc_lines[0].strip() == "Inhoud" and [n(re.sub(r" \d+$", "", l)) for l in toc_lines[1:]] == [n(h) for h in h2]
    print("   contents block = 'Inhoud' + the %d section headings of the source, in order: %s" % (len(h2), ok_toc))
    nbad += (not ok_toc)
    flat = n(pdf_text)
    blocks = [n("".join(bk)) for bk in x.blocks]; blocks = [bk for bk in blocks if bk]
    miss = [p for p in blocks if p not in flat]
    print("   text blocks of the source (paragraphs, list items, headings, table cells, code blocks, title page): %d; found verbatim in the PDF text: %d" % (len(blocks), len(blocks) - len(miss)))
    # v3: a block that continues on the next page has the page footer inside it, and the kicker on the title page is
    # upper-cased by CSS; such blocks are searched again in the text without footers, ignoring case
    foot_rx = re.compile(r"Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs\s*pagina \d+ van \d+")
    flat_nf = n("\n".join(foot_rx.sub("", " ".join(pg.split())) for pg in pages)).casefold()
    still = [p for p in miss if p.casefold() not in flat_nf]
    for p in miss: print("      not verbatim as extracted (%s): %s" % ("STILL MISSING" if p in still else "found after removing the page footer / ignoring case", p[:110]))
    print("   blocks not found after removing page footers and ignoring case: %d" % len(still))
    nbad += len(still)
    wa = collections.Counter(n(src_text)) + collections.Counter(n(add_text)); wb = collections.Counter(flat)
    dc = {k: (wa.get(k, 0), wb.get(k, 0)) for k in set(wa) | set(wb) if wa.get(k, 0) != wb.get(k, 0)}
    print("   characters (whitespace-free): source + additions %d, PDF %d; characters with different counts: %s" % (sum(wa.values()), sum(wb.values()), dc))
print("\nTOTAL whole-document problems:", nbad)
