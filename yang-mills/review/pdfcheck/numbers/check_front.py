#!/usr/bin/env python3
"""Title page + verification section of REPORT_v1.pdf against the evidence files and the JSON files."""
import json, re, glob, os, subprocess, math
ROOT="/home/user/frisoj/yang-mills"
QA="/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
pages=open(QA+"/numverify/pdf_layout.txt",encoding="utf-8").read().split("\f")
raw=open(QA+"/numverify/pdf_raw.txt",encoding="utf-8").read().split("\f")
p1=" ".join(pages[0].split()); p4=" ".join((raw[3]+" "+raw[4]).split())
ENS=["d3_b6.0_L16","d3_b6.0_L24","d3_b9.0_L24","d3_b9.0_L24r","d3_b9.0_L24_combined","d3_b12.0_L32","d4_b2.3_L10","d4_b2.4_L12","d4_b2.4_L16","d4_b2.5_L16","d4_b2.5_L16x","d4_b2.5_L16_combined","d4_b2.5_L20"]
P={e:json.load(open(f"{ROOT}/results/{e}.json")) for e in ENS}
res=[]
def chk(what, printed, expected):
    good = printed==expected
    res.append(good); print(("OK   " if good else "MISMATCH ")+what+f": pdf {printed!r}  evidence {expected!r}")
rd=lambda *p: open(os.path.join(ROOT,*p),encoding="utf-8").read()

# ---------- title page
m=re.search(r"Omvang (\d+) roosters, (\d+) metingen in (\d+) onafhankelijke reeksen",p1)
ind=[e for e in ENS if not e.endswith("_combined")]
lat={(P[e]["D"],P[e]["beta"],tuple(P[e]["shape"])) for e in ENS}
chk("title: lattices (distinct D, beta, shape over the 13 JSON files)", int(m.group(1)), len(lat))
chk("title: measurements (sum n_meas_total over the 11 non-combined JSON files)", int(m.group(2)), sum(P[e]["n_meas_total"] for e in ind))
chk("title: same sum from the per-stream n_meas", int(m.group(2)), sum(s["n_meas"] for e in ind for s in P[e]["streams"]))
seeds=[s["seed"] for e in ind for s in P[e]["streams"]]
chk("title: streams (non-combined)", int(m.group(3)), len(seeds))
chk("title: all stream seeds distinct", len(set(seeds)), len(seeds))
files=[s["file"] for e in ind for s in P[e]["streams"]]
chk("title: all stream files distinct", len(set(files)), len(files))
# the combined analyses contain exactly the streams of their parts
for c,parts in (("d3_b9.0_L24_combined",["d3_b9.0_L24","d3_b9.0_L24r"]),("d4_b2.5_L16_combined",["d4_b2.5_L16","d4_b2.5_L16x"])):
    chk(f"{c}: streams = streams of its two parts", [(s["seed"],s["n_meas"]) for s in P[c]["streams"]], [(s["seed"],s["n_meas"]) for p in parts for s in P[p]["streams"]])
m=re.search(r"git-commit (\w+)",p1)
git=lambda *a: subprocess.run(["git",*a],cwd=ROOT,capture_output=True,text=True).stdout.strip()
CP=["REPORT.md","results","ym","tests","analyze.py","summarize.py","independent_analysis.py","literature.json"]
chk("title: git commit (last commit touching the content paths)", m.group(1), git("log","-1","--format=%h","--",*CP))
chk("title: that commit is HEAD", m.group(1), git("rev-parse","--short","HEAD"))
chk("title: content paths have no uncommitted changes", git("status","--porcelain","--",*CP), "")
m=re.search(r"Datum (\d+) (\w+) (\d{4})",p1)
y,mo,d=git("log","-1","--format=%cs","--",*CP).split("-")
MONTHS=["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"]
chk("title: date = commit date", (int(m.group(1)),m.group(2),m.group(3)), (int(d),MONTHS[int(mo)-1],y))

# ---------- verification table
# row 1
m=re.search(r"klopt: (\d+) tests\. Standaardrun: (\d+) geslaagd, (\d+) overgeslagen \(dat zijn de trage tests\)\. De (\d+) trage tests apart gedraaid: (\d+) geslaagd",p4)
t=rd("review","numcheck","pytest_final_tree.txt")
mm=re.search(r"(\d+) passed, (\d+) skipped",t)
chk("row 1: passed", int(m.group(2)), int(mm.group(1))); chk("row 1: skipped", int(m.group(3)), int(mm.group(2)))
chk("row 1: total", int(m.group(1)), int(mm.group(1))+int(mm.group(2)))
chk("row 1: pytest_final_tree.txt: exit=0, no 'failed', no 'error'", ("exit=0" in t, "failed" in t, "error" in t.lower()), (True,False,False))
dots=sum(l.split("[")[0].count(".") for l in t.split("\n") if "%]" in l); ss=sum(l.split("[")[0].count("s") for l in t.split("\n") if "%]" in l)
chk("row 1: progress characters in pytest_final_tree.txt (dots, s)", (dots,ss), (int(mm.group(1)),int(mm.group(2))))
slow=0
for i in range(4):
    s=rd("review","numcheck",f"slow_out_{i}.txt"); n=int(re.search(r"(\d+) passed",s).group(1)); slow+=n
    ids=[l for l in rd("review","numcheck",f"slow_{i}.txt").split("\n") if l.strip()]
    chk(f"row 1: slow group {i}: passed == ids listed in slow_{i}.txt, exit=0, no fail", (n,"exit=0" in s,"failed" in s), (len(ids),True,False))
chk("row 1: slow tests passed (sum of 4 groups)", int(m.group(5)), slow)
chk("row 1: slow tests announced", int(m.group(4)), int(mm.group(2)))
allids=[l for i in range(4) for l in rd("review","numcheck",f"slow_{i}.txt").split("\n") if l.strip()]
sid=[l for l in rd("review","numcheck","slow_ids.txt").split("\n") if l.strip()]
chk("row 1: the 4 groups together = slow_ids.txt, no duplicates", (sorted(allids),len(set(allids))), (sorted(sid),len(sid)))
chk("row 1: collect.txt total", int(m.group(1)), int(re.search(r"(\d+) tests collected",rd("review","numcheck","collect.txt")).group(1)))
# row 4
m=re.search(r"Alle (\d+) analyses opnieuw gerekend uit de ruwe data, zonder gedeelde code\. Grootste afwijking van een centrale waarde: (\d),(\d)·10(\S+) keer",p4)
c=rd("results","independent","COMPARISON.md")
mm=re.search(r"\*\*Mechanical summary\.\*\*\s+(\d+) ensembles\.\s+Largest deviation of any compared central value from the pipeline: ([0-9.eE+-]+) pipeline sigma",c)
chk("row 4: number of analyses", int(m.group(1)), int(mm.group(1)))
sup=str.maketrans("⁻⁰¹²³⁴⁵⁶⁷⁸⁹","-0123456789")
printed=float(f"{m.group(2)}.{m.group(3)}e{m.group(4).translate(sup)}")
chk("row 4: largest deviation", printed, float(mm.group(2)))
I={e:json.load(open(f"{ROOT}/results/independent/{e}.json")) for e in ENS}
mx=max(I[e]["comparison_with_pipeline"]["max_abs_dev_sigma"] for e in ENS)
mx2=max(abs(r["dev_sigma"]) for e in ENS for r in I[e]["comparison_with_pipeline"]["rows"] if r.get("dev_sigma") is not None)
chk("row 4: largest deviation recomputed from the 13 independent JSON files (max_abs_dev_sigma)", f"{printed:.1e}", f"{mx:.1e}")
chk("row 4: same from the individual comparison rows", f"{printed:.1e}", f"{mx2:.1e}")
print("     rows compared in the independent files:", sum(len(I[e]["comparison_with_pipeline"]["rows"]) for e in ENS))
# my own recomputation of the largest deviation from the two sets of JSON files (glueball/torelon meff t=0..2, plaquette)
worst=0
for e in ENS:
    for r in I[e]["comparison_with_pipeline"]["rows"]:
        if r.get("pipeline_err"):
            worst=max(worst, abs(r["mine"]-r["pipeline"])/r["pipeline_err"])
print("     (mine - pipeline)/pipeline_err recomputed from the rows: max = %.3e"%worst)
# row 5
m=re.search(r"Het begin van (\d+) van de (\d+) reeksen van ronde 1 en 2 is opnieuw gegenereerd",p4)
h=rd("review","report","stats_rerun_a3_hist.txt")
bi=re.findall(r"^(\S+) \((hot|cold) start, seed (\d+)\).*bit-identical: (\d+) of (\d+) \(max \|diff\| glue ([^)]*)\)",h,flags=re.M)
chk("row 5: streams regenerated and fully bit-identical", int(m.group(1)), sum(1 for b in bi if b[3]==b[4] and int(b[4])>0 and b[5]=="0"))
chk("row 5: streams listed in the file", int(m.group(1)), len(bi))
S=json.load(open(f"{ROOT}/results/summary.json"))
r12=[e for e in ind if S["ensembles"][e]["round"] in ("1","2")]
chk("row 5: streams of rounds 1 and 2", int(m.group(2)), sum(len(P[e]["streams"]) for e in r12))
seeds12={s["seed"]:("hot" if s["start"]=="hot" else "cold") for e in r12 for s in P[e]["streams"]}
chk("row 5: every regenerated seed is a round-1/2 production seed with the same start", all(int(b[2]) in seeds12 and seeds12[int(b[2])]==b[1] for b in bi), True)
# row 6
m=re.search(r"vergeleken met de resultaatbestanden: (\d+) cellen, (\d+) afwijkingen",p4)
mm=re.search(r"OK count (\d+)\s+mismatches (\d+)",rd("review","numcheck","out_final","check_tables.txt"))
chk("row 6: cells", int(m.group(1)), int(mm.group(1))); chk("row 6: mismatches", int(m.group(2)), int(mm.group(2)))
chk("row 6: no MISMATCH/UNPARSABLE line in check_tables.txt", len(re.findall(r"MISMATCH|UNPARSABLE",rd("review","numcheck","out_final","check_tables.txt"))), 0)
# row 7
m=re.search(r"klopt: (\d+) waarden en verschillen in §4\.8 nagerekend: (\d+) afwijkingen",p4)
c4=rd("review","numcheck","out_final","check4.txt")
mm=re.search(r"OK count (\d+)\s+mismatches (\d+)",c4)
chk("row 7: count as printed in check4.txt", int(m.group(1)), int(mm.group(1))); chk("row 7: mismatches", int(m.group(2)), int(mm.group(2)))
chk("row 7: no MISMATCH/UNPARSABLE/CHECK line in check4.txt", len(re.findall(r"^(MISMATCH|UNPARSABLE|CHECK )",c4,flags=re.M)), 0)
# row 8
m=re.search(r"klopt: (\d+) verschillende getallen met fout in het rapport: (\d+) automatisch teruggevonden in een projectbestand, (\d+) met de hand",p4)
tt=rd("review","numcheck","out_final","trace_tokens.txt")
mm=re.search(r"distinct tokens: (\d+)\s+untraced by literal/pool match: (\d+)",tt)
chk("row 8: distinct tokens", int(m.group(1)), int(mm.group(1))); chk("row 8: by hand", int(m.group(3)), int(mm.group(2)))
chk("row 8: automatic", int(m.group(2)), int(mm.group(1))-int(mm.group(2)))
chk("row 8: UNTRACED lines in the file", len(re.findall(r"UNTRACED",tt)), int(mm.group(2)))
# my own count of distinct value(error) tokens in REPORT.md, with the same definition (decimal point in the value, sign dropped)
rep=rd("REPORT.md")
mine={t.lstrip("-") for t in re.findall(r"-?\d+\.\d+\(\d+(?:\.\d+)?\)",rep)}
chk("row 8: distinct value(error) tokens in the current REPORT.md (own count)", int(m.group(1)), len(mine))
# row 9
m=re.search(r"criterium van ronde 3 geeft \+(\d+),(\d+)σ bij een drempel van (\d)σ",p4)
c3=rd("review","numcheck","out_final","check3.txt")
mm=re.search(r"t1 meas-A sigma: report ([0-9.]+)\s+computed ([0-9.]+)",c3)
chk("row 9: sigma (check3.txt, 2 decimals)", f"{m.group(1)}.{m.group(2)}", f"{float(mm.group(2)):.2f}")
r3=S["round3"]
chk("row 9: sigma (summary.json round3.t1.measured_minus_A.sigma)", f"{m.group(1)}.{m.group(2)}", f"{r3['t1']['measured_minus_A']['sigma']:.2f}")
chk("row 9: threshold", float(m.group(3)), r3["criterion_sigma"])
g20=P["d4_b2.5_L20"]["glueball"]["fixed_t"]["t1"]; g16=P["d4_b2.5_L16_combined"]["glueball"]["fixed_t"]["t1"]
A=g16["m"]*16/20; dA=g16["err"]*16/20
sig=(g20["m"]-A)/math.hypot(g20["err"],dA)
chk("row 9: sigma recomputed from results/d4_b2.5_L20.json and d4_b2.5_L16_combined.json", f"{m.group(1)}.{m.group(2)}", f"{sig:.2f}")
print("     own value: measured %.6f +- %.6f, prediction A = 16/20 x %.6f = %.6f +- %.6f, difference = %+.4f sigma"%(g20["m"],g20["err"],g16["m"],A,dA,sig))
chk("row 9: verdict in summary.json: reading A excluded", r3["verdict"]["reading_A_excluded"], True)
chk("row 9: no MISMATCH line in check2.txt / check3.txt", len(re.findall(r"MISMATCH|UNPARSABLE",rd("review","numcheck","out_final","check2.txt")+c3)), 0)
print(); print("front matter: %d checks, %d OK, %d mismatches"%(len(res),sum(res),len(res)-sum(res)))
