#!/usr/bin/env python3
"""Every value(error) token of REPORT.md must occur in the PDF body (pages 3-30), equally often."""
import re, collections, json
import pypdfium2 as pdfium
QA="/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
ROOT="/home/user/frisoj/yang-mills"
md=open(ROOT+"/REPORT.md",encoding="utf-8").read()
TOK=re.compile(r"(?<![\w.])[-−]?\d+(?:\.\d+)?\(\d+(?:\.\d+)?\)")
TOKW=re.compile(r"(?<![\w.])[-−]?\d+(?:\.\s*\d+)?\s*\(\s*\d+(?:\.\d+)?\s*\)")   # line break inside allowed
def toks(text, rx):
    return collections.Counter(re.sub(r"\s+","",m.group(0)) for m in rx.finditer(text))
mdc=toks(md,TOK)
strict=collections.Counter(t.lstrip("-−") for t in mdc.elements() if re.match(r"[-−]?\d+\.\d+\(",t))
print("REPORT.md: value(error) tokens: %d occurrences, %d distinct (with a decimal point in the value: %d occurrences, %d distinct after dropping the sign)"%(sum(mdc.values()),len(mdc),sum(strict.values()),len(strict)))
print("  tokens without a decimal point in the value:", sorted(t for t in mdc if not re.match(r"[-−]?\d+\.\d+\(",t)))
srcs={}
raw=open(QA+"/numverify/pdf_raw.txt",encoding="utf-8").read().split("\f")
lay=open(QA+"/numverify/pdf_layout.txt",encoding="utf-8").read().split("\f")
srcs["pdftotext raw order"]=raw; srcs["pdftotext -layout"]=lay
pdf=pdfium.PdfDocument(QA+"/REPORT_v1.pdf")
srcs["pdfium"]=[pdf[i].get_textpage().get_text_range() for i in range(len(pdf))]
PUA=json.load(open(QA+"/numverify/pua_map.json"))
import pickle
pl,_=pickle.load(open(QA+"/numverify/plumber.pkl","rb"))
srcs["pdfplumber + ActualText map"]=["".join(PUA.get(c,c) for c in p) for p in pl]
for name,pages in srcs.items():
    body="\n".join(pages[2:30])
    pc=toks(body,TOKW)
    missing={t:(n,pc.get(t,0)) for t,n in mdc.items() if pc.get(t,0)<n}
    extra={t:(mdc.get(t,0),n) for t,n in pc.items() if mdc.get(t,0)<n}
    # second chance for tokens broken by a line break in a way the regex cannot see: look in whitespace-free text
    flat=re.sub(r"\s+","",body)
    really=[t for t in missing if flat.count(t)<mdc[t]]
    print(f"\n[{name}] PDF pages 3-30: {sum(pc.values())} occurrences, {len(pc)} distinct")
    print("   tokens of REPORT.md found with the same count:", sum(1 for t,n in mdc.items() if pc.get(t,0)==n), "of", len(mdc))
    print("   fewer in PDF (md count, pdf count):", missing)
    print("   of those not found either in the whitespace-free text:", really)
    print("   more in PDF than in REPORT.md (md count, pdf count):", extra)
whole=toks("\n".join(srcs["pdftotext raw order"]),TOKW)
print("\nwhole PDF (44 pages): %d value(error) occurrences, %d distinct"%(sum(whole.values()),len(whole)))
