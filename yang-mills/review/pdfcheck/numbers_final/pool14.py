import json, glob, re, os
from decimal import Decimal
ROOT="/home/user/frisoj/yang-mills"
toks=["0.8015(41)","1.0929(1292)","0.860(60)","1.17(11)","0.874(78)","1.555(21)","1.449(32)","1.338(24)","0.02(12)","1.011(23)","0.975(13)","0.0138(59)","3.962(82)","0.891(103)"]
files=sorted(glob.glob(ROOT+"/results/d*.json"))+sorted(glob.glob(ROOT+"/results/independent/d*.json"))+[ROOT+"/results/summary.json"]
def parse(tok):
    m=re.fullmatch(r"(-?\d+\.(\d+))\((\d+)\)",tok); nd=len(m.group(2)); return float(m.group(1)), int(m.group(3))*10**-nd, nd
def walk(o, path, out):
    if isinstance(o, dict):
        nums={k:v for k,v in o.items() if isinstance(v,(int,float)) and not isinstance(v,bool)}
        out.append((path, nums))
        for k,v in o.items(): walk(v, path+"/"+str(k), out)
    elif isinstance(o, list):
        nums={i:v for i,v in enumerate(o) if isinstance(v,(int,float)) and not isinstance(v,bool)}
        if nums: out.append((path, nums))
        for i,v in enumerate(o): walk(v, path+f"[{i}]", out)
allnodes=[]
for f in files:
    out=[]; walk(json.load(open(f)), os.path.relpath(f,ROOT), out); allnodes+=out
lines=open(ROOT+"/REPORT.md",encoding="utf-8").read().split("\n")
for tok in toks:
    v,e,nd=parse(tok); tol=0.5*10**-nd*1.0000001
    hits=[]
    for path,nums in allnodes:
        kv=[k for k,x in nums.items() if abs(abs(x)-v)<=tol]
        ke=[k for k,x in nums.items() if abs(x-e)<=tol]
        if kv and ke: hits.append((path,kv[:2],ke[:2]))
    ln=[i+1 for i,l in enumerate(lines) if tok in l]
    print(tok, 'REPORT.md lines', ln, '| paired (same JSON node) hits:', len(hits))
    for h in hits[:3]: print('     ', h)
    for i in ln[:1]:
        l=lines[i-1]; j=l.find(tok); print('      context: ...'+l[max(0,j-170):j+len(tok)+60].replace("\n"," ")+'...')
