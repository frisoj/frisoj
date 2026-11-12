#!/usr/bin/env python3
import re, collections, subprocess, unicodedata, difflib
from html.parser import HTMLParser
QA="/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
ROOT="/home/user/frisoj/yang-mills"
md=open(ROOT+"/REPORT.md",encoding="utf-8").read()
md2=re.sub(r"\n\$\$\n(.*?)\n\$\$\n","\n\n",md,flags=re.S)
keep=[]; head=True
for ln in md2.split("\n"):
    if ln.startswith("## 0. "): head=False
    if head and (ln.startswith("# ") or ln.startswith("**SU(2)-roostersimulaties") or ln.strip()=="---"): continue
    keep.append(ln)
html=subprocess.run(["pandoc","-f","gfm","-t","html5","--columns=100000"],input="\n".join(keep),capture_output=True,text=True,check=True).stdout
class X(HTMLParser):
    def __init__(s): super().__init__(convert_charrefs=True); s.out=[]; s.imgs=[]; s.intable=0; s.tab=[]; s.par=[]
    def handle_starttag(s,tag,attrs):
        if tag=="img": s.imgs.append(dict(attrs).get("alt",""))
        if tag=="table": s.intable+=1
        if tag in("p","li","h1","h2","h3","h4","pre","blockquote","tr","td","th","br"): s.out.append("\n")
    def handle_endtag(s,tag):
        if tag=="table": s.intable-=1
    def handle_data(s,d):
        s.out.append(d); (s.tab if s.intable else s.par).append(d)
x=X(); x.feed(html)
mdtext="".join(x.out)
print("images in REPORT.md:", len(x.imgs))
raw=open(QA+"/numverify/pdf_raw.txt",encoding="utf-8").read().split("\f")
foot=re.compile(r"^Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs\s*$|^pagina \d+ van \d+\s*$|^Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs\s+pagina \d+ van \d+$")
body="\n".join(l for i in [2]+list(range(5,30)) for l in raw[i].split("\n") if not foot.match(l.strip()))
# the build renames the appendix heading
mdtext=mdtext.replace("Bijlage: herkomst van de getallen","Bijlage A: herkomst van de getallen")
body=body.replace("Vooraf en leeswijzer\n","",1)
NUM=re.compile(r"\d+(?:[.,]\d+)*")
a=collections.Counter(NUM.findall(mdtext)); b=collections.Counter(NUM.findall(body))
print("digit strings: REPORT.md %d occurrences (%d distinct); PDF body %d occurrences (%d distinct)"%(sum(a.values()),len(a),sum(b.values()),len(b)))
print("  fewer in PDF (md, pdf):", {k:(v,b.get(k,0)) for k,v in a.items() if b.get(k,0)<v})
print("  fewer in REPORT.md (md, pdf):", {k:(a.get(k,0),v) for k,v in b.items() if a.get(k,0)<v})
n=lambda t: re.sub(r"\s+","",unicodedata.normalize("NFC",t).replace(" "," "))
wa=collections.Counter(n(mdtext)); wb=collections.Counter(n(body))
diff={k:(wa.get(k,0),wb.get(k,0)) for k in set(wa)|set(wb) if wa.get(k,0)!=wb.get(k,0)}
print("characters (whitespace-free): REPORT.md %d, PDF body %d; different counts: %s"%(sum(wa.values()),sum(wb.values()),diff))
# sequence comparison of the running text (everything outside tables), paragraph order is the same in both
partext=n("".join(x.par).replace("Bijlage: herkomst van de getallen","Bijlage A: herkomst van de getallen"))
# remove table cell text from the PDF side is not possible by position here; instead check that every paragraph of the md occurs verbatim in the whitespace-free PDF text
flat=n(body)
paras=[n(p) for p in re.split(r"\n+", "".join(x.par)) if n(p)]
miss=[p for p in paras if p.replace("Bijlage:herkomstvandegetallen","BijlageA:herkomstvandegetallen") not in flat]
print("running-text blocks (paragraphs, list items, headings, code lines) of REPORT.md: %d; found verbatim in the PDF text: %d"%(len(paras),len(paras)-len(miss)))
for p in miss[:20]:
    # show the closest difference
    sm=difflib.SequenceMatcher(None,p,flat,autojunk=False)
    m=sm.find_longest_match(0,len(p),0,len(flat))
    print("   NOT FOUND verbatim (%d chars): %s ...| longest common run %d chars"%(len(p),p[:150],m.size))
    print("        md  around break: ...%s"%p[max(0,m.a+m.size-40):m.a+m.size+40])
    print("        pdf around break: ...%s"%flat[max(0,m.b+m.size-40):m.b+m.size+40])
