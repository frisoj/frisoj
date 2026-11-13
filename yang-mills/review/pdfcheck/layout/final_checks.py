#!/usr/bin/env python3
"""Text-layer checks of the final build against the frozen v3 copy.  usage: final_checks.py new.pdf v3.pdf"""
import collections, logging, re, subprocess, sys
logging.disable(logging.CRITICAL)
from pypdf import PdfReader
new, old = sys.argv[1], sys.argv[2]
TOK = re.compile(r"[+\-−]?\d+[.,]\d+\(\d+(?:\.\d+)?\)")
FOOT = re.compile(r"Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs\s*|pagina \d+ van \d+\s*")

def poppler(f):
    return subprocess.run(["pdftotext", f, "-"], capture_output=True, text=True).stdout
def pypdf_text(f):
    return "\f".join((p.extract_text() or "") for p in PdfReader(f).pages)

for name, fn in (("pdftotext", poppler), ("pypdf", pypdf_text)):
    a, b = fn(new), fn(old)
    ta, tb = collections.Counter(TOK.findall(a)), collections.Counter(TOK.findall(b))
    print(f"[{name}] value(error) tokens: new {sum(ta.values())} ({len(ta)} distinct), v3 {sum(tb.values())} ({len(tb)} distinct), "
          f"multisets equal: {ta == tb}")
    da, db = collections.Counter(re.findall(r"\d+", FOOT.sub("", a))), collections.Counter(re.findall(r"\d+", FOOT.sub("", b)))
    diff = {k: (da[k], db[k]) for k in set(da) | set(db) if da[k] != db[k]}
    print(f"[{name}] digit strings (footers removed): new {sum(da.values())}, v3 {sum(db.values())}, differences: {diff}")
    print(f"[{name}] U+FFFD in new: {a.count(chr(0xFFFD))}; private-use chars in new: {sum(1 for c in a if 0xE000 <= ord(c) <= 0xF8FF)}")
    # words: same multiset of words apart from repeated table headers
    wa, wb = collections.Counter(FOOT.sub("", a).split()), collections.Counter(FOOT.sub("", b).split())
    dw = {k: (wa[k], wb[k]) for k in set(wa) | set(wb) if wa[k] != wb[k]}
    print(f"[{name}] words: new {sum(wa.values())}, v3 {sum(wb.values())}; words with a different count: {dw}")

# footers and contents
pages = poppler(new).split("\f")[:-1]
n = len(pages)
bad = [i + 1 for i, p in enumerate(pages) if f"pagina {i + 1} van {n}" not in p or "numeriek bewijsmateriaal, geen bewijs" not in p]
print(f"pages: {n}; pages without a correct footer: {bad}")
r = PdfReader(new)
dest = {}
from urllib.parse import unquote
for k, d in r.named_destinations.items():
    try: dest[unquote(str(k).lstrip("/"))] = r.get_destination_page_number(d) + 1
    except Exception: pass
toc = pages[1].split("Vooraf en leeswijzer", 2)   # contents on page 2
lines = [l.strip() for l in subprocess.run(["pdftotext", "-layout", "-f", "2", "-l", "2", new, "-"], capture_output=True, text=True).stdout.splitlines()]
entries = []
for l in lines:
    m = re.match(r"^(.*\S)\s{2,}(\d+)$", l)
    if m: entries.append((m.group(1), int(m.group(2))))
print("contents entries:", len(entries))
ok = True
for title, pg in entries:
    # the heading must be the start of a line on that page, and on no earlier page after the contents
    first = next((i + 1 for i, p in enumerate(pages) if i >= 1 and re.search(r"(?m)^\s*" + re.escape(title) + r"\s*$", p) and not (i == 1 and title != "Vooraf en leeswijzer")), None)
    if title == "Vooraf en leeswijzer":
        first = 2 if pages[1].count(title) >= 2 else None
    print(f"   {pg:3d}  heading found on page {first}  {'OK' if first == pg else 'MISMATCH'}  {title}")
    ok &= first == pg
print("contents page numbers all correct:", ok)
h2 = {k: v for k, v in dest.items() if re.match(r"^(vooraf|verificatie|\d-|bijlage-)", k)}
print("named destinations of the 12 sections:", sorted(h2.items(), key=lambda kv: kv[1]))
print("outline (bookmarks) entries:", sum(1 for _ in r.outline) if r.outline else 0)
