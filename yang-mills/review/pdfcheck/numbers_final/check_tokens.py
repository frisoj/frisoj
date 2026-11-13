#!/usr/bin/env python3
"""v2: every value(error) token of REPORT.md must occur in the PDF report part (page 2 = preamble with the
reading guide, pages 6-27 = sections 0-6 and appendix A), equally often. Five text extractions; no
private-use map is needed any more."""
import re, collections, json
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
for label,fn in (("pdftotext raw order","pdf_raw.txt"),("pdftotext -layout","pdf_layout.txt"),("pdfium","pdf_pdfium.txt"),
                 ("pdfplumber (plain, no map)","pdf_plumber.txt"),("pypdf (plain, no map)","pdf_pypdf.txt")):
    srcs[label]=open(QA+"/numbers-v4/"+fn,encoding="utf-8").read().split("\f")[:42]
nbad=0
for name,pages in srcs.items():
    assert "Vooraf en leeswijzer" in pages[1] and "0. In het kort" in pages[5] and "Bijlage A: herkomst" in pages[26] and "Bijlage B: de uitslagen" in pages[27]
    body="\n".join([pages[1]]+pages[5:27])
    pc=toks(body,TOKW)
    missing={t:(n,pc.get(t,0)) for t,n in mdc.items() if pc.get(t,0)<n}
    extra={t:(mdc.get(t,0),n) for t,n in pc.items() if mdc.get(t,0)<n}
    # second chance for tokens broken by a line break in a way the regex cannot see: look in whitespace-free text
    flat=re.sub(r"\s+","",body)
    really=[t for t in missing if flat.count(t)<mdc[t]]
    print(f"\n[{name}] PDF pages 2 and 6-27: {sum(pc.values())} occurrences, {len(pc)} distinct")
    nbad+=len(really)+len(extra)
    print("   tokens of REPORT.md found with the same count:", sum(1 for t,n in mdc.items() if pc.get(t,0)==n), "of", len(mdc))
    print("   fewer in PDF (md count, pdf count):", missing)
    print("   of those not found either in the whitespace-free text:", really)
    print("   more in PDF than in REPORT.md (md count, pdf count):", extra)
print()
ref=None
for name,pages in srcs.items():
    whole=toks("\n".join(pages),TOKW)
    print("whole PDF (42 pages) [%s]: %d value(error) occurrences, %d distinct"%(name,sum(whole.values()),len(whole)))
    if ref is None: ref=(name,whole)
    else:
        d={t:(ref[1].get(t,0),whole.get(t,0)) for t in set(ref[1])|set(whole) if ref[1].get(t,0)!=whole.get(t,0)}
        print("   difference from [%s] (token: count there, count here): %s"%(ref[0],d))
        nbad+=len(d)
# expected total: report part + appendix B blocks + the examples in the appendix B introduction
lay=srcs["pdftotext -layout"]
parts={"p2 + p6-27 (report)":[lay[1]]+lay[5:27],"p1, p3-5 (title, contents excluded, verification)":[lay[0]]+lay[2:5],"p28 (appendix B introduction)":[lay[27]],"p29-41 (appendix B, 13 analyses)":lay[28:41],"p42 (appendix C)":[lay[41]]}
tot=0
for k,v in parts.items():
    c=toks("\n".join(v),TOKW); tot+=sum(c.values())
    print("   %-52s %4d occurrences%s"%(k,sum(c.values()),("  "+str(dict(c)) if sum(c.values())<10 else "")))
print("   sum of the parts:",tot)
print("\nTOTAL token problems:",nbad)
