#!/usr/bin/env python3
"""Compare every Markdown table (REPORT.md, and the assembled document_v4.md) with the tables
reconstructed from the PDF: number of rows, number of columns, text of every cell."""
import json, re, subprocess, sys, unicodedata
from html.parser import HTMLParser
QA="/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
ROOT="/home/user/frisoj/yang-mills"

class T(HTMLParser):
    def __init__(s):
        super().__init__(convert_charrefs=True); s.tables=[]; s.row=None; s.cell=None; s.depth=0
    def handle_starttag(s, tag, attrs):
        if tag=="table": s.tables.append([]); s.depth+=1
        elif tag=="tr" and s.depth: s.row=[]
        elif tag in("td","th") and s.row is not None: s.cell=[]
        elif tag=="br" and s.cell is not None: s.cell.append(" ")
    def handle_endtag(s, tag):
        if tag=="table": s.depth-=1
        elif tag=="tr" and s.row is not None: s.tables[-1].append(s.row); s.row=None
        elif tag in("td","th") and s.cell is not None: s.row.append("".join(s.cell)); s.cell=None
    def handle_data(s, d):
        if s.cell is not None: s.cell.append(d)

def md_tables(path):
    html=subprocess.run(["pandoc",path,"-f","gfm","-t","html5","--columns=10000"],capture_output=True,text=True,check=True).stdout
    p=T(); p.feed(html); return p.tables

def norm(x):
    x=unicodedata.normalize("NFC",x).replace("\u00a0"," ").replace("\u02ee","”")
    return re.sub(r"\s+","",x)

frags=json.load(open(QA+"/numbers-v4/pdf_tables.json"))
for i,f in enumerate(frags):
    f["first_on_page"] = (i==0 or frags[i-1]["page"]!=f["page"])
    f["last_on_page"] = (i==len(frags)-1 or frags[i+1]["page"]!=f["page"])
# merge page fragments: a fragment without header, or with a header identical to the open table's header at the top of the next page
pdf=[]
for f in frags:
    rows=[list(r) for r in f["rows"]]
    if pdf and len(f["cols"])==pdf[-1]["ncols"] and f["page"]==pdf[-1]["lastpage"]+1 and pdf[-1]["open"]:
        if not f["has_header"]:
            pdf[-1]["rows"]+=rows; pdf[-1]["lastpage"]=f["page"]; pdf[-1]["pages"].append(f["page"]); continue
        if [norm(c) for c in rows[0]]==[norm(c) for c in pdf[-1]["rows"][0]] and f.get("first_on_page") and pdf[-1].get("last_on_page"):
            # header repeated at the top of the next page: continuation of the same table
            pdf[-1]["rows"]+=rows[1:]; pdf[-1]["lastpage"]=f["page"]; pdf[-1]["pages"].append(f["page"]); pdf[-1]["last_on_page"]=f.get("last_on_page"); continue
    if pdf and pdf[-1].get("rep") and not f["has_header"] and len(f["cols"])==pdf[-1]["ncols"] and f["page"]==pdf[-1]["lastpage"]:
        pdf[-1]["rows"]+=rows; continue
    pdf.append({"ncols":len(f["cols"]),"rows":rows,"lastpage":f["page"],"pages":[f["page"]],"open":True,"last_on_page":f.get("last_on_page")})

def compare(label, md, pdf_tabs):
    print(f"\n===== {label}: {len(md)} Markdown tables, {len(pdf_tabs)} PDF tables")
    bad=0; cells=0; tok=0
    for i,(m,p) in enumerate(zip(md,pdf_tabs)):
        ok = len(m)==len(p["rows"]) and all(len(r)==p["ncols"] for r in m)
        diffs=[]
        if ok:
            for ri,(mr,pr) in enumerate(zip(m,p["rows"])):
                for ci,(mc,pc) in enumerate(zip(mr,pr)):
                    cells+=1; tok+=len(re.findall(r"\d+\.\d+\(\d+(?:\.\d+)?\)",mc))
                    if norm(mc)!=norm(pc): diffs.append((ri,ci,mc,pc))
        status = "OK" if ok and not diffs else "DIFF"
        if status!="OK": bad+=1
        print(f"  table {i+1:2d} (pdf page {p['pages']}): md {len(m)} rows x {len(m[0])} cols | pdf {len(p['rows'])} rows x {p['ncols']} cols | {status}  header: {[c[:16] for c in m[0]][:3]}")
        for d in diffs[:8]: print("       cell diff row %d col %d:\n          md : %r\n          pdf: %r"%d)
    if len(md)!=len(pdf_tabs): bad+=1; print("  NUMBER OF TABLES DIFFERS")
    print(f"  -> {label}: {len(md)-bad if len(md)==len(pdf_tabs) else '?'} of {len(md)} tables identical (rows, columns, every cell); cells compared {cells}; value(error) tokens inside those cells {tok}")
    return bad

doc=md_tables(QA+"/document_v4.md")
rep=md_tables(ROOT+"/REPORT.md")
b1=compare("assembled document_v4.md vs PDF (all tables)", doc, pdf)
# v2: REPORT.md tables = the PDF tables of pages 6..27 (section 0 starts on p. 6, appendix A is on p. 27)
body=[p for p in pdf if 6<=p["pages"][0]<=27]
b2=compare("REPORT.md vs PDF pages 6-27", rep, body)
print("\nTOTAL table mismatches:", b1+b2)
