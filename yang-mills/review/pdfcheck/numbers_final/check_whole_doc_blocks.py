#!/usr/bin/env python3
"""v3 addition to check_whole_doc.py: every source text block that is 'not verbatim' in the PDF text must be
explained by (a) a page footer between two parts of the block (block continues on the next page) or
(b) the CSS upper-casing of the title-page kicker. After removing the footers and case-folding, every block
must be found verbatim."""
import re, subprocess, unicodedata, sys
from html.parser import HTMLParser
QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
ROOT = "/home/user/frisoj/yang-mills"
html_doc = subprocess.run(["pandoc", QA + "/document_v4.md", "-f", "gfm", "-t", "html5", "--columns=100000"], capture_output=True, text=True, check=True).stdout
title = open(ROOT + "/pdf/build/title.html", encoding="utf-8").read()
class X(HTMLParser):
    def __init__(s):
        super().__init__(convert_charrefs=True); s.blocks = []
    def handle_starttag(s, tag, attrs):
        if tag in ("p", "li", "h1", "h2", "h3", "h4", "pre", "td", "th", "blockquote"): s.blocks.append([])
    def handle_data(s, d):
        if s.blocks: s.blocks[-1].append(d)
x = X(); x.feed(title); x.feed(html_doc)
n = lambda t: re.sub(r"\s+", "", unicodedata.normalize("NFC", t).replace(" ", " ").replace("ˮ", "”"))
foot = re.compile(r"Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs\s*pagina \d+ van \d+")
nbad = 0
for name, fn in (("pdfium", "pdf_pdfium.txt"), ("pypdf", "pdf_pypdf.txt"), ("pdfplumber", "pdf_plumber.txt")):
    pages = open(QA + "/numbers-v4/" + fn, encoding="utf-8").read().replace("\r", "").replace("￾", "-").replace("\x02", "-").split("\f")[:42]
    with_foot = n("\n".join(pages))
    nfoot = sum(len(foot.findall(" ".join(p.split()))) for p in pages)
    nofoot = n("\n".join(foot.sub("", " ".join(p.split())) for p in pages))
    blocks = [n("".join(b)) for b in x.blocks]; blocks = [b for b in blocks if b]
    miss0 = [b for b in blocks if b not in with_foot]
    miss1 = [b for b in blocks if b not in nofoot]
    miss2 = [b for b in miss1 if b.casefold() not in nofoot.casefold()]
    print("[%s] footers removed: %d | blocks %d | not verbatim with footers %d | after removing footers %d | after also case-folding %d"
          % (name, nfoot, len(blocks), len(miss0), len(miss1), len(miss2)))
    for b in miss1:
        if b not in miss2: print("     explained by upper-casing:", b[:80])
    for b in miss2:
        print("     STILL NOT VERBATIM:", b[:200])
    if name != "pdfplumber": nbad += len(miss2)
    # numbers in the blocks that needed a footer removal
    for b in miss0:
        if b in miss1: continue
print("TOTAL unexplained blocks (pdfium, pypdf):", nbad)
