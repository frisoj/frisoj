#!/usr/bin/env python3
"""Appendix B (PDF) against Tables 1 and 2 of the report body (PDF): same quantities, possibly other rounding."""
import json, re, collections
from decimal import Decimal
QA="/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
frags=json.load(open(QA+"/numbers-v4/pdf_tables.json"))
n=lambda s: re.sub(r"\s+","",s)
# v2: Table 1 is split over pages 9 and 10 (header repeated); Table 2 is on page 10
# Table 1 (10 columns) may be whole on one page or split over two, with the header repeated
parts=[f["rows"] for f in frags if f["page"] in (9,10) and len(f["cols"])==10]
assert parts, "Table 1 not found on pages 9-10"
for p in parts[1:]: assert [n(c) for c in parts[0][0]]==[n(c) for c in p[0]]
T1=parts[0]+[r for p in parts[1:] for r in p[1:]]; T2=[f for f in frags if f["page"] in (9,10,11) and len(f["cols"])==9][0]["rows"]
assert len(T1)==14 and len(T2)==14
ENS=[n(r[0]) for r in T1[1:]]
key=[f for f in frags if 29<=f["page"]<=41 and len(f["cols"])==4]
assert len(key)==13
TOK=re.compile(r"(\d+\.\d+)\((\d+(?:\.\d+)?)\)")
def parse(s):
    m=TOK.search(n(s))
    if not m: return None
    v,e=m.group(1),m.group(2); nd=len(v.split(".")[1])
    return Decimal(v), (Decimal(e) if "." in e else Decimal(e)*Decimal(1).scaleb(-nd)), nd
def consistent(a,b):
    """two printed value(error) of the same number: the less precise one must be the rounding of a number within the
    rounding interval of the more precise one."""
    (va,ea,na),(vb,eb,nb)=a,b
    if na<nb: (va,ea,na),(vb,eb,nb)=(vb,eb,nb),(va,ea,na)
    # a is the more precise one
    q=Decimal(1).scaleb(-nb); h=Decimal(1).scaleb(-na)/2
    return abs(va-vb)<=q/2+h and abs(ea-eb)<=q/2+h
more=fewer=same=0; bad=[]; cnt=0; ex_more=[]; ex_fewer=[]
for i,e in enumerate(ENS):
    kb=key[i]["rows"]; r1=T1[i+1]; r2=T2[i+1]
    assert n(r2[0])==e
    pairs=[("glueball R5",r1[7],kb[1][1]),("glueball t1",r1[8],kb[1][2]),("glueball t2",r1[9],kb[1][3]),
           ("torelon R5",r2[2],kb[2][1]),("a sqrt(sigma) R5",r2[3],kb[3][1]),("a sqrt(sigma) t1",r2[4],kb[3][2]),("a sqrt(sigma) t2",r2[5],kb[3][3]),
           ("ratio R5",r2[6],kb[5][1]),("ratio t1",r2[7],kb[5][2]),("ratio t2",r2[8],kb[5][3])]
    for what,body,app in pairs:
        pb,pa=parse(body),parse(app)
        if pb is None or pa is None:
            print(f"  {e:22s} {what:18s} body {n(body)!r:28s} appendix B {n(app)!r}")
            continue
        cnt+=1
        if not consistent(pb,pa): bad.append((e,what,n(body),n(app)))
        if pa[2]>pb[2]: more+=1; ex_more.append((e,what,n(body),n(app)))
        elif pa[2]<pb[2]: fewer+=1; ex_fewer.append((e,what,n(body),n(app)))
        else: same+=1
    # t* in brackets
    for what,body,app in (("glueball t*",r1[7],kb[1][1]),("torelon t*",r2[2],kb[2][1])):
        tb=re.search(r"\[(\d+)\]",n(body)); ta=re.search(r"\[t\*=(\d+)\]",n(app))
        if tb and ta:
            cnt+=1
            if tb.group(1)!=ta.group(1): bad.append((e,what,n(body),n(app)))
print(f"compared {cnt} cells of Tables 1 and 2 with appendix B: inconsistent {len(bad)}")
for b in bad: print("   INCONSISTENT",b)
print(f"decimals in appendix B versus report tables: more {more}, fewer {fewer}, same {same}")
print("   examples with MORE digits in appendix B:", ex_more[:6])
print("   examples with FEWER digits in appendix B:", ex_fewer[:6])
