#!/usr/bin/env python3
"""Stronger than the token check: ALL digit strings and the whole word sequence of REPORT.md against the PDF body."""
import re, collections, subprocess, difflib, unicodedata
QA="/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
ROOT="/home/user/frisoj/yang-mills"
md=open(ROOT+"/REPORT.md",encoding="utf-8").read()
nform=len(re.findall(r"\n\$\$\n(.*?)\n\$\$\n",md,flags=re.S))
md2=re.sub(r"\n\$\$\n(.*?)\n\$\$\n","\n\n",md,flags=re.S)       # the 4 display formulas are images in the PDF
# title lines are dropped by the build
keep=[]
head=True
for ln in md2.split("\n"):
    if ln.startswith("## 0. "): head=False
    if head and (ln.startswith("# ") or ln.startswith("**SU(2)-roostersimulaties") or ln.strip()=="---"): continue
    keep.append(ln)
md2="\n".join(keep)
plain=subprocess.run(["pandoc","-f","gfm","-t","plain","--columns=100000"],input=md2,capture_output=True,text=True,check=True).stdout
raw=open(QA+"/numverify/pdf_raw.txt",encoding="utf-8").read().split("\f")
foot=re.compile(r"^Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs\s*$|^pagina \d+ van \d+\s*$|^Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs\s+pagina \d+ van \d+$")
body="\n".join(l for i in [2]+list(range(5,30)) for l in raw[i].split("\n") if not foot.match(l.strip()))
print("display formulas removed from the Markdown side:", nform)
NUM=re.compile(r"\d+(?:[.,]\d+)*")
a=collections.Counter(NUM.findall(plain)); b=collections.Counter(NUM.findall(body))
print("digit strings: REPORT.md %d occurrences (%d distinct); PDF body %d occurrences (%d distinct)"%(sum(a.values()),len(a),sum(b.values()),len(b)))
print("  in REPORT.md but fewer in PDF:", {k:(v,b.get(k,0)) for k,v in a.items() if b.get(k,0)<v})
print("  in PDF but fewer in REPORT.md:", {k:(a.get(k,0),v) for k,v in b.items() if a.get(k,0)<v})
# whole text, whitespace-free character multiset and sequence outside tables
def norm(t):
    t=unicodedata.normalize("NFC",t).replace(" "," ")
    return t
def words(t):
    return re.findall(r"[^\s|+\-=:]+", norm(t))
# drop table rule characters of pandoc's plain tables
plain_nt=re.sub(r"^[\s\-+=|:]+$","",plain,flags=re.M)
wa=collections.Counter(re.sub(r"\s+","",plain_nt)); wb=collections.Counter(re.sub(r"\s+","",body))
diff={k:(wa.get(k,0),wb.get(k,0)) for k in set(wa)|set(wb) if wa.get(k,0)!=wb.get(k,0)}
print("characters (whitespace-free): REPORT.md %d, PDF body %d; characters with different counts: %s"%(sum(wa.values()),sum(wb.values()),dict(sorted(diff.items(), key=lambda kv:-abs(kv[1][0]-kv[1][1]))[:40])))
