#!/usr/bin/env python3
"""v2, task 4: the text layer of REPORT_v4.pdf in five extractions (pdftotext raw and -layout, pypdf, pdfplumber,
pypdfium2): private-use characters, digits, value(error) tokens, decimal numbers, non-ASCII characters;
the same counts for REPORT_v1.pdf with pypdf/pdfplumber for comparison; fonts from pdffonts."""
import re, collections, subprocess, unicodedata, logging
logging.disable(logging.CRITICAL)
QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
TOKW = re.compile(r"(?<![\w.])[-−]?\d+(?:\.\s*\d+)?\s*\(\s*\d+(?:\.\d+)?\s*\)")
DEC = re.compile(r"\d+[.,]\d+")
files = [("pdftotext raw", "pdf_raw.txt"), ("pdftotext -layout", "pdf_layout.txt"), ("pypdf", "pdf_pypdf.txt"),
         ("pdfplumber", "pdf_plumber.txt"), ("pypdfium2", "pdf_pdfium.txt")]
ref = None; nbad = 0
foot = re.compile(r"Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs|pagina \d+ van \d+")
for name, fn in files:
    t = open(QA + "/numbers-v4/" + fn, encoding="utf-8").read()
    pages = t.split("\f")[:42]
    t = "\n".join(pages)
    pua = sum(1 for c in t if 0xE000 <= ord(c) <= 0xF8FF)
    dig = collections.Counter(c for c in t if c.isascii() and c.isdigit())
    tok = collections.Counter(re.sub(r"\s+", "", m.group(0)) for m in TOKW.finditer(t))
    dec = collections.Counter(DEC.findall(t))
    nonascii = collections.Counter(c for c in t if ord(c) > 127 and not c.isspace())
    wf = collections.Counter(re.sub(r"\s+", "", unicodedata.normalize("NFC", t)))
    print("[%-17s] pages %d | private-use chars %d | U+FFFD %d | ASCII digits %d | value(error) tokens %d (%d distinct) | decimal numbers %d (%d distinct) | non-ASCII chars %d (%d distinct)"
          % (name, len(pages), pua, t.count("�"), sum(dig.values()), sum(tok.values()), len(tok), sum(dec.values()), len(dec), sum(nonascii.values()), len(nonascii)))
    if pua: nbad += 1
    if ref is None:
        ref = (name, dig, tok, dec, nonascii, wf)
    else:
        for label, a, b in (("digits", ref[1], dig), ("value(error) tokens", ref[2], tok), ("non-ASCII characters", ref[4], nonascii)):
            d = {k: (a.get(k, 0), b.get(k, 0)) for k in set(a) | set(b) if a.get(k, 0) != b.get(k, 0)}
            if d:
                print("      %s differ from [%s] (there, here): %s" % (label, ref[0], {("U+%04X %s" % (ord(k), k) if len(k) == 1 and ord(k) > 127 else k): v for k, v in d.items()}))
                if label != "non-ASCII characters": nbad += 1
        d = {k: (ref[3].get(k, 0), dec.get(k, 0)) for k in set(ref[3]) | set(dec) if ref[3].get(k, 0) != dec.get(k, 0)}
        if d: print("      decimal numbers differ from [%s] (there, here): %s" % (ref[0], d))
        dw = {("U+%04X %s" % (ord(k), k)): (ref[5].get(k, 0), wf.get(k, 0)) for k in set(ref[5]) | set(wf) if ref[5].get(k, 0) != wf.get(k, 0)}
        print("      all characters, whitespace-free: %d (reference %d); characters with a different count: %s" % (sum(wf.values()), sum(ref[5].values()), dw))
print()
# v1 for comparison (pypdf, pdfplumber)
from pypdf import PdfReader
import pdfplumber
for label, path in (("v1", QA + "/REPORT_v1.pdf"), ("v3", QA + "/REPORT_v4.pdf")):
    t1 = "\n".join((p.extract_text() or "") for p in PdfReader(path).pages)
    with pdfplumber.open(path) as pdf:
        t2 = "\n".join((p.extract_text() or "") for p in pdf.pages)
    for nm, t in (("pypdf", t1), ("pdfplumber", t2)):
        print("%s %-10s: private-use chars %6d | ASCII digits %6d | value(error) tokens %4d" % (label, nm, sum(1 for c in t if 0xE000 <= ord(c) <= 0xF8FF),
              sum(c.isascii() and c.isdigit() for c in t), len(TOKW.findall(t))))
print()
out = subprocess.run(["pdffonts", QA + "/REPORT_v4.pdf"], capture_output=True, text=True).stdout
rows = [l.split() for l in out.split("\n")[2:] if l.strip()]
fam = collections.Counter()
for r in rows:
    name = r[0].split("+")[-1]
    typ = " ".join(r[1:-6])
    fam[(name, typ, r[-5], r[-4], r[-3])] += 1
print("fonts in REPORT_v4.pdf (pdffonts): %d font objects" % len(rows))
for (name, typ, emb, sub, uni), k in sorted(fam.items()):
    print("   %-26s %-22s embedded %-3s subset %-3s ToUnicode %-3s  x%d" % (name, typ, emb, sub, uni, k))
out1 = subprocess.run(["pdffonts", QA + "/REPORT_v1.pdf"], capture_output=True, text=True).stdout
fam1 = collections.Counter((l.split()[0].split("+")[-1], " ".join(l.split()[1:-6])) for l in out1.split("\n")[2:] if l.strip())
print("fonts in REPORT_v1.pdf for comparison:", dict(fam1))
print("\nTOTAL text-layer problems (private-use characters, or digits/tokens that differ between extractors):", nbad)
