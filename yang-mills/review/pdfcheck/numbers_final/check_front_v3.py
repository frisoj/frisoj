#!/usr/bin/env python3
"""Build v3: title page, verification section, 'Wat niet bevestigd is', appendix B introduction and
appendix C of REPORT_v4.pdf, every number against its evidence file.

Independent of pdf/make_pdf.py: the numbers are read from the PDF text (argument: text file with one
form feed between pages, default pdf_pypdf.txt) and recomputed here from the evidence files, the 13
result files, the 13 independent files, git and (row 1) a live test collection.
Nothing is written into the project.
"""
import json, re, os, subprocess, math, sys, hashlib, glob
sys.dont_write_bytecode = True
ROOT = "/home/user/frisoj/yang-mills"
QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
SRC = sys.argv[1] if len(sys.argv) > 1 else "pdf_pypdf.txt"
pages = open(os.path.join(QA, "numbers-v4", SRC), encoding="utf-8").read().split("\f")
flat = lambda *idx: " ".join(" ".join(pages[i] for i in idx).split())
# pypdf writes the closing quote of Inter as U+02EE; normalise both closing quotes
norm = lambda s: s.replace("ˮ", "”")
p1 = norm(flat(0)); ver = norm(flat(2, 3, 4)); pB = norm(flat(27)); pC = norm(flat(41))
ENS = ["d3_b6.0_L16", "d3_b6.0_L24", "d3_b9.0_L24", "d3_b9.0_L24r", "d3_b9.0_L24_combined", "d3_b12.0_L32",
       "d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.4_L16", "d4_b2.5_L16", "d4_b2.5_L16x", "d4_b2.5_L16_combined",
       "d4_b2.5_L20"]
P = {e: json.load(open(f"{ROOT}/results/{e}.json")) for e in ENS}
I = {e: json.load(open(f"{ROOT}/results/independent/{e}.json")) for e in ENS}
S = json.load(open(f"{ROOT}/results/summary.json"))
LIT = json.load(open(f"{ROOT}/literature.json"))
res = []


def chk(what, printed, expected):
    good = printed == expected
    res.append(good)
    short = lambda x: (repr(x) if len(repr(x)) <= 300 else repr(x)[:140] + " ... [%d chars] ... " % len(repr(x)) + repr(x)[-60:])
    print(("OK       " if good else "MISMATCH ") + what + f": pdf {short(printed)}  evidence {short(expected)}")
    return good


def need(pattern, text, what):
    m = re.search(pattern, text)
    if not m:
        res.append(False)
        print("MISMATCH (text not found in PDF) " + what + ": /" + pattern + "/")
        raise SystemExit(1)
    return m


rd = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()
git = lambda *a: subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout.strip()
nlf = lambda s: float(s.replace(",", ".").replace("−", "-").replace("+", ""))
ind = [e for e in ENS if not e.endswith("_combined")]

# rounds: NOT from summary.json but from the three run scripts (round 1, 2, 3)
def script_names(fn):
    return re.findall(r'^\s*"(d[34]_b[\d.]+_L\d+\w*)\|', rd(fn), flags=re.M)
ROUND = {}
for rnd, fn in (("1", "run_all_production.sh"), ("2", "run_extra_production.sh"), ("3", "run_round3_production.sh")):
    for n in script_names(fn):
        ROUND[n] = rnd
chk("rounds: the three run scripts list exactly the 11 non-combined analyses", sorted(ROUND), sorted(ind))
chk("rounds: run scripts agree with summary.json", {n: ROUND[n] for n in ind}, {n: str(S["ensembles"][n]["round"]) for n in ind})
r12 = [e for e in ind if ROUND[e] in ("1", "2")]
r3 = [e for e in ind if ROUND[e] == "3"]

print("\n================ TITLE PAGE (p. 1)")
m = need(r"Omvang (\d+) roosters, (\d+) metingen in (\d+) onafhankelijke stromen \(meetreeksen\)", p1, "title: Omvang")
lat = {(P[e]["D"], P[e]["beta"], tuple(P[e]["shape"])) for e in ENS}
chk("title: lattices = distinct (D, beta, shape) over the 13 result files", int(m.group(1)), len(lat))
chk("title: lattices, counted over the 11 non-combined files only", int(m.group(1)), len({(P[e]["D"], P[e]["beta"], tuple(P[e]["shape"])) for e in ind}))
chk("title: measurements = sum n_meas_total over the 11 non-combined result files", int(m.group(2)), sum(P[e]["n_meas_total"] for e in ind))
chk("title: same sum from the per-stream n_meas", int(m.group(2)), sum(s["n_meas"] for e in ind for s in P[e]["streams"]))
chk("title: same sum from the independent files", int(m.group(2)), sum(I[e]["n_meas_total"] for e in ind))
seeds = [s["seed"] for e in ind for s in P[e]["streams"]]
chk("title: streams (non-combined)", int(m.group(3)), len(seeds))
chk("title: all stream seeds distinct", len(set(seeds)), len(seeds))
files = [s["file"] for e in ind for s in P[e]["streams"]]
chk("title: all stream files distinct", len(set(files)), len(files))
for c, parts in (("d3_b9.0_L24_combined", ["d3_b9.0_L24", "d3_b9.0_L24r"]), ("d4_b2.5_L16_combined", ["d4_b2.5_L16", "d4_b2.5_L16x"])):
    chk(f"{c}: streams = streams of its two parts (no extra data)", [(s["seed"], s["n_meas"]) for s in P[c]["streams"]],
        [(s["seed"], s["n_meas"]) for p in parts for s in P[p]["streams"]])
m = need(r"rapport, code en resultaten: git-commit (\w+)", p1, "title: commit")
CP = ["REPORT.md", "results", "ym", "tests", "analyze.py", "summarize.py", "independent_analysis.py", "literature.json"]
commit = m.group(1)
chk("title: git commit = last commit touching report, code and results", commit, git("log", "-1", "--format=%h", "--", *CP))
chk("title: those paths are identical in that commit and in HEAD (git diff --stat empty)", git("diff", "--stat", commit, "HEAD", "--", *CP), "")
chk("title: those paths have no uncommitted changes (git status --porcelain empty)", git("status", "--porcelain", "--", *CP), "")
print("         (HEAD is now %s: %s)" % (git("rev-parse", "--short", "HEAD"), git("log", "-1", "--format=%s")))
m = need(r"rapport en resultaten: (\d+) (\w+) (\d{4})", p1, "title: date of report and results")
y, mo, d = git("log", "-1", "--format=%cs", commit).split("-")
MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"]
chk("title: date = date of that commit", (int(m.group(1)), m.group(2), m.group(3)), (int(d), MONTHS[int(mo) - 1], y))
chk("title: 'in 2, 3 en 4 dimensies' present", "SU(2)-roostersimulaties in 2, 3 en 4 dimensies" in p1, True)
chk("title: D of the production lattices = {3, 4}; D = 2 only in the tests", sorted({P[e]["D"] for e in ENS}), [3, 4])
chk("title: says not solved / no proof", ("niet opgelost" in p1, "Het bevat geen bewijs" in p1), (True, True))
chk("title (v3): subtitle ends with 'wat het wel en niet laat zien' (no 'bewijst' on the title page)", ("hoe het gecontroleerd is, en wat het wel en niet laat zien" in p1, "bewijst" in p1), (True, False))
chk("title (v3): 'correct' sentence: measurement outcomes recomputed and agree with stored data; not: solved", ("de meetuitkomsten in dit document zijn nagerekend en kloppen met de opgeslagen meetdata. Het betekent niet dat het probleem is opgelost" in p1), True)
chk("title (v3): 'door geen mens nagekeken' on the title page", "door geen mens nagekeken" in p1, True)

print("\n================ VERIFICATION, paragraph above the table (v3): what the second analysis recomputed")
need(r"De hoofdgetallen \(plaquette, effectieve massa's bij t = 0 tot en met 3, snaarspanning bij t = 1 en 2, en de verhouding volgens regel R5\) zijn met een tweede, apart "
     r"geschreven analyse nagerekend\. De effectieve massa's bij t = 4 tot en met 6 heeft de tweede analyse ook berekend, maar ze zitten niet in haar opgeslagen vergelijking met de eerste\. De consistentiegetallen in bijlage B \(χ² van de stromen, warm min koud, autocorrelatietijd\) komen uit de eerste analyse; de tweede berekent zulke getallen op een eigen manier en komt daardoor niet op precies dezelfde waarden\. De verhouding m/√σ bij "
     r"vaste t komt uit die tweede analyse: de waarde volgt ook uit de getallen van de eerste, de fout niet\.", ver, "paragraph above the table")
CORE = ["plaq"] + [f"{c}.gevp.m{t}" for c in ("glue", "tor") for t in (0, 1, 2, 3)] + ["tor.gevp.asNG1", "tor.gevp.asL1", "tor.gevp.asNG2", "tor.gevp.asL2"]
nrows = 0; worst = 0.0; missing = []; ratio_rows = {}; extra_keys = set()
for e in ENS:
    rows_ = {r["key"]: r for r in I[e]["comparison_with_pipeline"]["rows"]}
    nrows += len(rows_)
    for k in CORE:
        if k not in rows_: missing.append((e, k))
    ratio_rows[e] = sorted(k for k in rows_ if k.startswith("ratio."))
    extra_keys |= set(rows_) - set(CORE) - set(ratio_rows[e])
    for r in rows_.values():
        worst = max(worst, abs(r["dev_sigma"]))
        # every row: 'mine' equals 'pipeline' to 1e-9 relative, and the jackknife error equals the pipeline error
        assert abs(r["mine"] - r["pipeline"]) <= 1e-9 * max(1.0, abs(r["pipeline"])), (e, r)
        assert abs(r["err_jack"] - r["pipeline_err"]) <= 1e-9 * r["pipeline_err"], (e, r)
chk("paragraph: plaquette, m_eff/E_eff at t = 0..3 (glueball and torelon), a sqrt(sigma) NG and Luescher at t = 1 and 2: a comparison row in each of the 13 files (13 x 13 = 169 rows)",
    (missing, 13 * len(CORE)), ([], 169))
chk("paragraph: the other comparison rows are the two differences m(1)-m(2) and the R5 ratio", sorted(extra_keys), ["glue.gevp.d12", "tor.gevp.d12"])
# the R5 ratio: one NG and one Luescher row at the pipeline's (t*_glue, t*_torelon) wherever the pipeline has an R5 ratio
exp_ratio = {}
for e in ENS:
    g_, t_ = P[e]["glueball"], P[e]["torelon"]
    exp_ratio[e] = [] if P[e]["ratios"]["upper_bound_only"] else sorted([f"ratio.gevp.NGx{g_['t_star']}{t_['t_star']}", f"ratio.gevp.Lx{g_['t_star']}{t_['t_star']}"])
chk("paragraph: 'verhouding volgens regel R5': ratio rows at the pipeline's t* in the 12 files that have an R5 ratio, none for d3_b6.0_L24 (geen meting)", ratio_rows, exp_ratio)
for e in ENS:
    for r in I[e]["comparison_with_pipeline"]["rows"]:
        if r["key"].startswith("ratio.gevp.NGx"):
            assert abs(r["pipeline"] - P[e]["ratios"]["m_over_sqrt_sigma"]["nambu_goto"]["value"]) <= 1e-9 * abs(r["pipeline"]), (e, r)
        if r["key"] == "plaq": assert abs(r["pipeline"] - P[e]["plaquette"]["mean"]) < 1e-9
        mm_ = re.fullmatch(r"(glue|tor)\.gevp\.m(\d)", r["key"])
        if mm_:
            tab = {x["t"]: x for x in P[e]["glueball" if mm_.group(1) == "glue" else "torelon"]["meff_table"]}
            assert abs(r["pipeline"] - tab[int(mm_.group(2))]["m_cosh"]) <= 1e-9 * abs(r["pipeline"]), (e, r)
        mm_ = re.fullmatch(r"tor\.gevp\.as(NG|L)(\d)", r["key"])
        if mm_:
            fx_ = {int(f["t"]): f for f in P[e]["string_tension"]["fixed_t"]}
            assert abs(r["pipeline"] - fx_[int(mm_.group(2))]["nambu_goto" if mm_.group(1) == "NG" else "luscher"]["a_sqrt_sigma"]) <= 1e-9 * abs(r["pipeline"]), (e, r)
chk("paragraph: the 'pipeline' column of those rows equals the numbers in results/<ens>.json (plaquette, meff_table, string_tension.fixed_t, ratios)", True, True)
chk("paragraph: total comparison rows in the 13 files (12 x 17 + 15), largest |dev_sigma| %.2e" % worst, (nrows, worst < 1e-9), (12 * 17 + 15, True))
allkeys = {r["key"] for e in ENS for r in I[e]["comparison_with_pipeline"]["rows"]}
chk("paragraph: 'm_eff bij t = 4 tot en met 6 niet': no comparison row for t >= 4", sorted(k for k in allkeys if re.search(r"\.m[4-9]$", k)), [])
chk("paragraph: 'consistentiegetallen niet': no comparison row for chi2 / hot-cold / tau_int", sorted(k for k in allkeys if re.search(r"chi2|hot|cold|pull|tau", k)), [])
# R5 values of glueball and torelon: the 'r5' block of comparison_with_pipeline
r5ok = 0
for e in ENS:
    for ch in ("glue", "tor"):
        a_, b_ = I[e]["comparison_with_pipeline"]["r5"][ch]["mine"], I[e]["comparison_with_pipeline"]["r5"][ch]["pipeline"]
        r5ok += (a_["flag"] == b_["flag"] and a_["t_star"] == b_["t_star"] and abs(a_["value"] - b_["value"]) <= 1e-9 * abs(b_["value"]) and abs(a_["err_jack"] - b_["err"]) <= 1e-9 * b_["err"])
chk("paragraph (extra): R5 flag, t*, value and error of glueball and torelon agree in the 'r5' block (13 x 2)", r5ok, 26)
# what appendix B prints from the second analysis: m/sqrt(sigma) at fixed t; value also follows from the pipeline numbers, the error does not
qok = 0; has_err = 0
for e in ENS:
    fx_ = {int(f["t"]): f for f in P[e]["string_tension"]["fixed_t"]}
    for tt in (1, 2):
        ir_ = I[e]["ratios"]["m_over_sqrt_sigma"]["gevp"][f"t{tt}"]["nambu_goto"]
        q_ = P[e]["glueball"]["fixed_t"][f"t{tt}"]["m"] / fx_[tt]["nambu_goto"]["a_sqrt_sigma"]
        qok += abs(q_ - ir_["value"]) <= 5e-7 * abs(q_)
def walk_keys(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items(): yield from walk_keys(v, path + "/" + str(k))
    elif isinstance(o, list):
        for i_, v in enumerate(o): yield from walk_keys(v, path + "[%d]" % i_)
    else: yield path, o
fixed_ratio_in_pipeline = sorted({p_ for e in ENS for p_, v in walk_keys(P[e]["ratios"]) if re.search(r"fixed|/t1|/t2", p_)})
chk("paragraph: m/sqrt(sigma) at fixed t: value of the second analysis = quotient of the pipeline numbers (13 x 2)", qok, 26)
chk("paragraph: 'de fout niet': results/<ens>.json has no fixed-t ratio (no key with fixed/t1/t2 under 'ratios')", fixed_ratio_in_pipeline, [])
# information only: does the second analysis contain m_eff at t = 4..6 and stream-consistency numbers of its own?
have46 = 0; agree46 = 0
for e in ENS:
    for ch, key in (("glueball", "glueball"), ("torelon", "torelon")):
        tabI = I[e][key].get("meff_all_t_gevp")
        tabP = {x["t"]: x for x in P[e][key]["meff_table"]}
        if not tabI: continue
        for row in tabI:
            t_ = row.get("t") if isinstance(row, dict) else None
            if t_ in (4, 5, 6) and tabP.get(t_) and tabP[t_].get("m_cosh") is not None:
                v_ = row.get("value", row.get("m", row.get("m_cosh")))
                if v_ is None: continue
                have46 += 1; agree46 += abs(v_ - tabP[t_]["m_cosh"]) <= 1e-6 * abs(tabP[t_]["m_cosh"])
print("         NOTE (information): independent files carry m_eff at t = 4..6 of their own ('meff_all_t_gevp'): %d values with a pipeline counterpart, %d equal to 1e-6;"
      " they are not part of comparison_with_pipeline, so 'niet nagerekend' is the conservative statement" % (have46, agree46))

print("\n================ VERIFICATION, row 1 (test suite)")
m = need(r"geslaagd: (\d+) tests\. Standaardrun op de definitieve code: (\d+) geslaagd, (\d+) overgeslagen \(dat zijn de trage tests\)\. "
         r"De (\d+) trage tests zijn kort daarvoor apart gedraaid: (\d+) geslaagd\. Daarna is alleen nog code gewijzigd die een figuur "
         r"tekent \(in summarize\.py ?\); de trage tests gebruiken dat bestand niet\.", ver, "row 1")
t = rd("review", "numcheck", "pytest_final_tree.txt")
mm = re.search(r"(\d+) passed, (\d+) skipped", t)
chk("row 1: passed (pytest_final_tree.txt)", int(m.group(2)), int(mm.group(1)))
chk("row 1: skipped (pytest_final_tree.txt)", int(m.group(3)), int(mm.group(2)))
chk("row 1: total = passed + skipped", int(m.group(1)), int(mm.group(1)) + int(mm.group(2)))
chk("row 1: pytest_final_tree.txt: exit=0, no 'failed', no 'error'", ("exit=0" in t, "failed" in t, "error" in t.lower()), (True, False, False))
prog = [l.split("[")[0] for l in t.split("\n") if "%]" in l]
chk("row 1: progress characters in pytest_final_tree.txt (dots, s, other)", (sum(l.count(".") for l in prog), sum(l.count("s") for l in prog),
    sum(len(l.strip()) - l.count(".") - l.count("s") for l in prog)), (int(mm.group(1)), int(mm.group(2)), 0))
slow = 0
for i in range(4):
    s = rd("review", "numcheck", f"slow_out_{i}.txt"); n = int(re.search(r"(\d+) passed", s).group(1)); slow += n
    ids = [l for l in rd("review", "numcheck", f"slow_{i}.txt").split("\n") if l.strip()]
    chk(f"row 1: slow group {i}: passed == ids listed in slow_{i}.txt, exit=0, no 'failed', no 'skipped'",
        (n, "exit=0" in s, "failed" in s, "skipped" in s), (len(ids), True, False, False))
chk("row 1: slow tests passed (sum of the 4 groups)", int(m.group(5)), slow)
chk("row 1: slow tests announced = skipped", int(m.group(4)), int(mm.group(2)))
allids = [l for i in range(4) for l in rd("review", "numcheck", f"slow_{i}.txt").split("\n") if l.strip()]
sid = [l for l in rd("review", "numcheck", "slow_ids.txt").split("\n") if l.strip()]
chk("row 1: the 4 groups together = slow_ids.txt, no duplicates", (sorted(allids), len(set(allids))), (sorted(sid), len(sid)))
chk("row 1: collect.txt total", int(m.group(1)), int(re.search(r"(\d+) tests collected", rd("review", "numcheck", "collect.txt")).group(1)))
# live collection (writes nothing into the project)
env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", NUMBA_NUM_THREADS="1", NUMBA_CACHE_DIR=os.path.join(QA, "numbers-v4", "numba_cache"))
live = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider"], cwd=ROOT, env=env, capture_output=True, text=True).stdout
chk("row 1: live collection now: total", int(m.group(1)), int(re.search(r"(\d+) tests collected", live).group(1)))
lslow = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider", "-m", "slow"], cwd=ROOT, env=env, capture_output=True, text=True).stdout
live_ids = sorted(l for l in lslow.split("\n") if "::" in l)
chk("row 1: live collection now: slow-marked tests", int(m.group(4)), len(live_ids))
chk("row 1: live slow ids == slow_ids.txt", live_ids, sorted(sid))
# what changed after the slow tests ran
slow_commit = git("log", "-1", "--format=%H", "--", "review/numcheck/slow_out_0.txt")
added = git("log", "--diff-filter=A", "--format=%H", "--", "review/numcheck/slow_out_0.txt")
chk("row 1: the slow outputs were committed once (added and last changed in the same commit)", slow_commit, added)
print("         slow outputs committed in %s" % git("log", "-1", "--format=%h %ci %s", slow_commit))
print("         final standard run committed in %s" % git("log", "-1", "--format=%h %ci %s", "--", "review/numcheck/pytest_final_tree.txt"))
CODE = ["ym", "tests", "analyze.py", "summarize.py", "independent_analysis.py", "run_production.py", "pytest.ini", "requirements.txt"]
changed = [p for p in git("diff", "--name-only", slow_commit, "HEAD", "--", *CODE).split("\n") if p]
chk("row 1: code files changed between that commit and HEAD (git diff --name-only, code paths + pytest.ini + requirements)", changed, ["yang-mills/summarize.py"])
prev = git("rev-parse", slow_commit + "^")
chk("row 1: no code change inside the commit that added the slow outputs (parent..commit)", git("diff", "--name-only", prev, slow_commit, "--", *CODE), "")
# every hunk of the summarize.py diff lies inside a figure function
diff = git("diff", "-U0", slow_commit, "HEAD", "--", "summarize.py")
src = rd("summarize.py").split("\n")
defs = [(i + 1, re.match(r"def (\w+)", l).group(1)) for i, l in enumerate(src) if re.match(r"def \w+", l)]
def func_at(line):
    name = None
    for ln, nm in defs:
        if ln <= line: name = nm
    return name
hunks = [(int(a), int(b or 1)) for a, b in re.findall(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", diff, flags=re.M)]
funcs = sorted({func_at(l) for a, n in hunks for l in range(a, a + max(n, 1))})
print("         summarize.py: %d hunks, in functions %s" % (len(hunks), funcs))
chk("row 1: all changed lines of summarize.py lie in figure-drawing functions", set(funcs) <= {"_ratio_panel", "make_figures"}, True)
slow_files = sorted({i.split("::")[0] for i in sid})
uses = [f for f in slow_files if re.search(r"\bsummarize\b", rd(f))]
chk("row 1: test files of the slow tests that mention summarize", uses, [])
chk("row 1: conftest.py mentions summarize", bool(re.search(r"\bsummarize\b", rd("tests", "conftest.py"))), False)
print("         slow tests live in:", slow_files)

print("\n================ VERIFICATION, row 2 (exact results, Schwinger-Dyson)")
m0 = need(r"binnen de statistische fout: (\d+) vergelijkingen van plaquette en Wilson-lussen, grootste afwijking (\d+,\d)σ; in de (\w+) andere tests in twee dimensies in dezelfde uitvoer "
          r"\(de energie van de fluxbuis, en een grootheid die nul moet zijn\) is de grootste afwijking (\d+,\d)σ \(de grens was vooraf (\d)σ\)\. .*? bij de (\d+) waarden van β "
          r"waarbij is gemeten, getest op kleine roosters: afwijkingen tussen ([−+]\d+,\d)σ en ([−+]\d+,\d)σ \(§2\)", ver, "row 2")
class _M:      # same group numbering as in the v2 script: 1 = 16, 2 = 1,4, 3 = bound, 4 = 6 couplings, 5, 6 = SD range
    def __init__(s, g): s.g = g
    def group(s, i): return s.g[i - 1]
m = _M([m0.group(1), m0.group(2), m0.group(5), m0.group(6), m0.group(7), m0.group(8)])
rp = rd("review", "report", "t_rP.txt")
g = re.findall(r"^\[g\] D=2 beta=(\S+?)[ :].*?dev = ([+-][0-9.]+) sigma", rp, flags=re.M)
chk("row 2: number of D=2 comparisons ([g] lines in t_rP.txt)", int(m.group(1)), len(g))
chk("row 2: they are 4 beta x (plaquette + 3 Wilson loops)", (len({b for b, _ in g}), len(g) // len({b for b, _ in g})), (4, 4))
mx = max(abs(float(z)) for _, z in g)
chk("row 2: largest |deviation| of the 16 (%.2f)" % mx, m.group(2), f"{mx:.1f}".replace(".", ","))
chk("row 2: bound 4 sigma: 'assert abs(dev) < 4.0' and 'assert abs(devw) < 4.0' in tests/test_engine.py", (int(m.group(3)),
    "assert abs(dev) < 4.0" in rd("tests", "test_engine.py"), "assert abs(devw) < 4.0" in rd("tests", "test_engine.py")), (4, True, True))
sd = re.findall(r"^\[SD prod\] (D\d_b[0-9.]+) \S+ (r\d): .*?\(([+-][0-9.]+) sigma\)", rp, flags=re.M)
chk("row 2: Schwinger-Dyson: distinct couplings in t_rP.txt", int(m.group(4)), len({c for c, _, _ in sd}))
chk("row 2: those couplings = the (D, beta) of the production analyses", sorted({c for c, _, _ in sd}), sorted({f"D{P[e]['D']}_b{P[e]['beta']}" for e in ENS}))
z = [float(x) for _, _, x in sd]
chk("row 2: Schwinger-Dyson lines (6 couplings x r1, r2)", len(z), 12)
chk("row 2: smallest SD deviation (%.2f)" % min(z), m.group(5), ("+" if min(z) > 0 else "") + f"{min(z):.1f}".replace(".", ",").replace("-", "−"))
chk("row 2: largest SD deviation (%.2f)" % max(z), m.group(6), ("+" if max(z) > 0 else "") + f"{max(z):.1f}".replace(".", ",").replace("-", "−"))
chk("row 2: t_rP.txt: 14 passed, exit 0", (bool(re.search(r"\b14 passed\b", rp)), "exit 0" in rp, "failed" in rp), (True, True, False))
tadv = rd("tests", "test_adversarial.py")
shapes = re.findall(r'^\s*"(D\d_b[\d.]+)": \(\(([\d, ]+)\), ([\d.]+), (\d+), SD_PROD_SIGMA', tadv, flags=re.M)
print("         SD production cases in tests/test_adversarial.py:", [(n, s) for n, s, _, _ in shapes])
chk("row 2: 'kleine roosters': SD production tests run on 8^3 and 6^4", sorted({s for _, s, _, _ in shapes}), ["6, 6, 6, 6", "8, 8, 8"])
# other D=2 comparisons with an exact answer in the same file, not among the 16
other = [float(x) for x in re.findall(r"pull ([+-][0-9.]+)", rp)]
perdir = [float(x) for blk in re.findall(r"per-direction pulls \[([^\]]*)\]", rp) for x in blk.split()]
print("         NOTE other pulls printed in t_rP.txt (D=2 torelon chain and null test; not among the 16): n = %d, range %+.2f .. %+.2f"
      % (len(other), min(other), max(other)))
print("         NOTE Schwinger-Dyson per-direction pulls in t_rP.txt: n = %d, range %+.2f .. %+.2f (the row quotes the all-direction values)"
      % (len(perdir), min(perdir), max(perdir)))
# v3: the row now names the 16 as plaquette + Wilson loops and quotes the two other D=2 tests separately
gq = re.findall(r"^\[g\] D=2 beta=\S+?(?: \([^)]*\))?: (P|W\(\d,\d\)) = ", rp, flags=re.M)
chk("row 2 (v3): the 16 are 4 plaquettes and 12 Wilson loops", (gq.count("P"), sum(1 for q in gq if q.startswith("W"))), (4, 12))
secs = re.split(r"^_{3,} (\S+) _{3,}$", rp, flags=re.M)      # [pre, name1, body1, name2, body2, ...]
tests_in_file = secs[1::2]
bodies = dict(zip(secs[1::2], secs[2::2]))
d2other = [t for t in tests_in_file if t.startswith("test_d2_")]
chk("row 2 (v3): tests in t_rP.txt: 6 SD production + 2 SD teeth + 4 [g] + the other D=2 tests", (len(tests_in_file), sum(t.startswith("test_schwinger_dyson_at_production") for t in tests_in_file),
    sum(t.startswith("test_schwinger_dyson_test_has_teeth") for t in tests_in_file), sum(t.startswith("test_g_d2_exact") for t in tests_in_file), d2other),
    (14, 6, 2, 4, ["test_d2_torelon_energy_and_string_tension_exact", "test_d2_plaquette_and_null_test"]))
chk("row 2 (v3): 'twee andere tests'", m0.group(3), {2: "twee"}.get(len(d2other)))
op = {t: [float(x) for x in re.findall(r"pull ([+-][0-9.]+)", bodies[t])] for t in d2other}
allp = [x for t in d2other for x in op[t]]
chk("row 2 (v3): every 'pull' in t_rP.txt lies in those two tests", sorted(allp), sorted(other))
mxo = max(abs(x) for x in allp)
print("         pulls: flux-tube energy test n = %d, max |pull| %.2f; null test n = %d, max |pull| %.2f"
      % (len(op[d2other[0]]), max(abs(x) for x in op[d2other[0]]), len(op[d2other[1]]), max(abs(x) for x in op[d2other[1]])))
chk("row 2 (v3): largest |deviation| in the two other tests (%.2f)" % mxo, m0.group(4), f"{mxo:.1f}".replace(".", ","))
tobs = rd("tests", "test_observables.py")
def fbody(name):
    i = tobs.index("def " + name + "("); j = tobs.find("\ndef ", i + 5); return tobs[i:j if j > 0 else len(tobs)]
b1, b2 = fbody("test_d2_torelon_energy_and_string_tension_exact"), fbody("test_d2_plaquette_and_null_test")
chk("row 2 (v3): bound 4 sigma also in the two other tests (tests/test_observables.py: '< 4.0 *' / '< 4.0'; no other sigma multiple)",
    ("< 4.0 * tor[\"aE_err\"]" in b1, "< 4.0 * row[\"err_cosh\"]" in b1, "assert abs(d2[\"plaquette_pull\"]) < 4.0" in b2, "assert nt[\"max_abs_pull\"] < 4.0" in b2,
     sorted(set(re.findall(r"< (\d\.\d) \*", b1 + b2)))), (True, True, True, True, ["4.0"]))
rep = rd("REPORT.md")
chk("row 2: REPORT.md §2 gives the same SD range", "liggen de afwijkingen tussen −2,0σ en +0,6σ" in rep, True)

print("\n================ VERIFICATION, row 3 (second simulation)")
need(r"tot op 10⁻¹², en beide simulaties geven statistisch dezelfde gemiddelden in 2, 3 en 4 dimensies", ver, "row 3")
need(r"De productieruns en de massa's van het lichtste deeltje \(de \"glueball\"\) zijn niet met de tweede simulatie nagerekend \(§2\)", ver, "row 3 (v3) limitation")
tc = rd("tests", "test_crosscheck.py")
chk("row 3: tolerance 1e-12 in tests/test_crosscheck.py (docstring and assert_same_observables)",
    ("must agree to 1e-12" in tc, "def assert_same_observables(eng, r, tol=1e-12)" in tc), (True, True))
chk("row 3: statistical cross-check in D = 2, 3, 4 (docstring)", "statistical cross-check of the two Monte Carlo codes in D = 2, 3, 4" in tc, True)

print("\n================ VERIFICATION, row 4 (second analysis)")
m = need(r"Alle (\d+) analyses zijn opnieuw berekend uit de ruwe data, .*? Grootste afwijking van een meetwaarde: (\d),(\d)·10(\S+) keer de statistische fout"
         r".*? Het gaf daarnaast (\d+) automatische signaleringen: plekken waar een getal een vooraf ingestelde grens overschrijdt\. Dat zijn aanleidingen om te kijken, geen "
         r"vastgestelde fouten\. De meeste gaan over foutmarges bij grotere blokken en over het punt bij β = 9 en zijn besproken in §4\.2 tot en met §4\.4; de overige, over de onderlinge "
         r"consistentie van de stromen en over de fout van de effectieve massa bij t = 3 \(alle in vier dimensies\), komen alleen voor een deel aan bod \(§4\.9\)", ver, "row 4")
c = rd("results", "independent", "COMPARISON.md")
mm = re.search(r"\*\*Mechanical summary\.\*\*\s+(\d+) ensembles\.\s+Largest deviation of any compared central value from the pipeline: ([0-9.eE+-]+) pipeline sigma\.\s+"
               r"Flags raised \([^)]*\): ([^\n]*)", c)
chk("row 4: number of analyses (COMPARISON.md)", int(m.group(1)), int(mm.group(1)))
chk("row 4: number of analyses = result files present", int(m.group(1)), len(glob.glob(f"{ROOT}/results/independent/d*_b*.json")))
sup = str.maketrans("⁻⁰¹²³⁴⁵⁶⁷⁸⁹", "-0123456789")
printed = float(f"{m.group(2)}.{m.group(3)}e{m.group(4).translate(sup)}")
chk("row 4: largest deviation (COMPARISON.md)", printed, float(mm.group(2)))
mx = max(I[e]["comparison_with_pipeline"]["max_abs_dev_sigma"] for e in ENS)
chk("row 4: largest deviation from the 13 independent files (max_abs_dev_sigma = %.4e)" % mx, f"{printed:.1e}", f"{mx:.1e}")
rows = [r for e in ENS for r in I[e]["comparison_with_pipeline"]["rows"]]
mx2 = max(abs(r["dev_sigma"]) for r in rows if r.get("dev_sigma") is not None)
chk("row 4: same from the %d individual comparison rows" % len(rows), f"{printed:.1e}", f"{mx2:.1e}")
flags_line = sum(int(x) for x in re.findall(r" x (\d+)", mm.group(3)))
chk("row 4: flags (sum of the 'x N' in the summary line)", int(m.group(5)), flags_line)
sec9 = c[c.index("## 9. Mechanical flags"):]
chk("row 4: flags (bullets in section 9 of COMPARISON.md)", int(m.group(5)), len(re.findall(r"^- \*\*", sec9, flags=re.M)))
chk("row 4: flags (sum of len(flags) in the 13 independent files)", int(m.group(5)), sum(len(I[e]["flags"]) for e in ENS))
# v3: 'De meeste gaan over foutmarges bij grotere blokken en over het punt bij beta = 9'; 'die over de consistentie van de stromen in vier dimensies'
fl = [(e, f["type"]) for e in ENS for f in I[e]["flags"]]
n_rebin = sum(1 for e, t in fl if t == "rebinning_error_change")
n_b9 = sum(1 for e, t in fl if e.startswith("d3_b9.0") and t != "rebinning_error_change")
n_stream = [(e, t) for e, t in fl if t.startswith("stream_chi2")]
n_rest = len(fl) - n_rebin - n_b9 - len(n_stream)
print("         flags by kind: rebinning error change %d; other flags on the beta = 9 analyses %d; stream chi2 %d (analyses %s); remaining %d"
      % (n_rebin, n_b9, len(n_stream), sorted({e for e, _ in n_stream}), n_rest))
chk("row 4 (v3): 'de meeste' = rebinning + beta-9 flags are more than half of the flags (%d of %d)" % (n_rebin + n_b9, len(fl)), 2 * (n_rebin + n_b9) > len(fl), True)
chk("row 4 (v3): the stream-consistency flags are all on D = 4 analyses", sorted({P[e]["D"] for e, _ in n_stream}), [4])
chk("row 4 (v3): REPORT.md has sections 4.2, 4.3, 4.4 and 4.9", [bool(re.search(r"^### %s " % s, rep, flags=re.M)) for s in ("4\\.2", "4\\.3", "4\\.4", "4\\.9")], [True] * 4)

print("\n================ VERIFICATION, row 5 (raw data regenerated)")
m = need(r"Het begin van (\d+) van de (\d+) stromen van ronde 1 en 2 is opnieuw gegenereerd uit de startgetallen \(seeds\)\. Alle (\d+) metingen .*? "
         r"Dat is (\d+,\d) % van de (\d+) metingen van ronde 1 en 2\. De andere (\d+) stromen en de (\d+) stromen van ronde 3 zijn niet opnieuw gegenereerd", ver, "row 5")
h = rd("review", "report", "stats_rerun_a3_hist.txt")
bi = re.findall(r"^(\S+) \((hot|cold) start, seed (\d+)\).*?; (\d+) coincide .*?bit-identical: (\d+) of (\d+) \(max \|diff\| glue ([^)]*)\)", h, flags=re.M)
chk("row 5: lines with 'bit-identical' in the file", len(re.findall("bit-identical", h)), len(bi))
chk("row 5: streams regenerated, all N of N with max diff 0", int(m.group(1)), sum(1 for b in bi if b[4] == b[5] == b[3] and int(b[5]) > 0 and b[6] == "0"))
chk("row 5: distinct seeds among them", int(m.group(1)), len({b[2] for b in bi}))
chk("row 5: streams of rounds 1 and 2 (result files; rounds from the run scripts)", int(m.group(2)), sum(len(P[e]["streams"]) for e in r12))
chk("row 5: measurements regenerated (sum of N)", int(m.group(3)), sum(int(b[5]) for b in bi))
tot12 = sum(P[e]["n_meas_total"] for e in r12)
chk("row 5: measurements of rounds 1 and 2", int(m.group(5)), tot12)
pct = 100.0 * sum(int(b[5]) for b in bi) / tot12
chk("row 5: percentage (%.4f %%)" % pct, m.group(4), f"{pct:.1f}".replace(".", ","))
chk("row 5: other streams of rounds 1 and 2", int(m.group(6)), sum(len(P[e]["streams"]) for e in r12) - len(bi))
chk("row 5: streams of round 3", int(m.group(7)), sum(len(P[e]["streams"]) for e in r3))
seeds12 = {s["seed"]: s["start"] for e in r12 for s in P[e]["streams"]}
chk("row 5: every regenerated seed is a round-1/2 production seed with the same start", all(int(b[2]) in seeds12 and seeds12[int(b[2])] == b[1] for b in bi), True)
seeds3 = {s["seed"] for e in r3 for s in P[e]["streams"]}
chk("row 5: no round-3 seed among the regenerated streams", sorted(seeds3 & {int(b[2]) for b in bi}), [])
chk("row 5: REPORT.md §2 says the same (24 of 40, 4320)", "Het begin van 24 van de 40 productiestromen van ronde 1 en 2" in rep and "alle 4320 metingen" in rep, True)
need(r"De ruwe data zelf staan niet in git; wie ze wil controleren, moet de simulatie opnieuw draaien, en krijgt op een andere computer andere aantallen metingen \(§6\.1, §6\.2\)", ver, "row 5 (v3) raw data")
chk("row 5 (v3): raw data not in git: 'git ls-files results/raw' empty, .gitignore lists results/raw/, REPORT.md §6.1 says so",
    (git("ls-files", "results/raw"), "results/raw/" in rd(".gitignore").split("\n"), "**Ruwe data** staan niet in git" in rep[rep.index("### 6.1"):rep.index("### 6.2")]), ("", True, True))
chk("row 5: title-page total = rounds 1+2 plus round 3", tot12 + sum(P[e]["n_meas_total"] for e in r3), 305656)

print("\n================ VERIFICATION, rows 6-9 (number check re-run on the final text)")
out = lambda n: rd("review", "numcheck", "out_final", n)
m = need(r"vergeleken met de resultaatbestanden: (\d+) cellen, (\d+) afwijkingen\. Opnieuw gedraaid op de definitieve tekst", ver, "row 6")
mm = re.search(r"OK count (\d+)\s+mismatches (\d+)", out("check_tables.txt"))
chk("row 6: cells (check_tables.txt)", int(m.group(1)), int(mm.group(1)))
chk("row 6: mismatches", int(m.group(2)), int(mm.group(2)))
chk("row 6: no MISMATCH/UNPARSABLE line in check_tables.txt", len(re.findall(r"MISMATCH|UNPARSABLE", out("check_tables.txt"))), 0)
t_out = os.path.getmtime(f"{ROOT}/review/numcheck/out_final/check_tables.txt")
chk("row 6: 'definitieve tekst': REPORT.md, THEORY.md and results unchanged since the commit named on the title page",
    git("diff", "--stat", commit, "HEAD", "--", "REPORT.md", "THEORY.md", "results"), "")

m = need(r"nagerekend: (\d+) waarden en verschillen nagerekend, de meeste in §4\.8 en een deel in §3\.4 en §3\.5: (\d+) rekenfouten\. .*? "
         r"in vier dimensies liggen de glueballmassa's tot (\d+,\d)σ boven gepubliceerde waarden \(§4\.8\)", ver, "row 7")
c4 = out("check4.txt")
mm = re.search(r"OK count (\d+)\s+mismatches (\d+)", c4)
chk("row 7: count (check4.txt)", int(m.group(1)), int(mm.group(1)))
chk("row 7: mismatches", int(m.group(2)), int(mm.group(2)))
chk("row 7: literature rows flagged in check4.txt", int(re.search(r"literature rows flagged: (\d+)", c4).group(1)), 0)
chk("row 7: no MISMATCH/UNPARSABLE/CHECK line in check4.txt", len(re.findall(r"^(MISMATCH|UNPARSABLE|CHECK )", c4, flags=re.M)), 0)
# largest pull of a D=4 glueball mass against a literature value, recomputed here from the result files
# and the rows of the two tables of REPORT.md section 4.8 (not from summary.json)
def table_after(header):
    lines = rep.split("\n"); outt = []
    for i, l in enumerate(lines):
        if l.startswith(header):
            rows_ = []
            for q in lines[i + 2:]:
                if not q.startswith("|"): break
                rows_.append([x.strip() for x in q.strip().strip("|").split("|")])
            outt.append(rows_)
    return outt
t4, t3 = table_after("| grootheid | wij (t = 1 / t = 2) | literatuur | niveau | verschil |")
MAP4 = {"a·m, β = 2.3 (12×10³)": "d4_b2.3_L10", "a·m, β = 2.4 (16×12³)": "d4_b2.4_L12", "a·m, β = 2.4 (16⁴)": "d4_b2.4_L16",
        "a·m, β = 2.5 (16⁴, ronde 1)": "d4_b2.5_L16", "a·m, β = 2.5 (16⁴, beide runs)": "d4_b2.5_L16_combined",
        "a·m, β = 2.5 (20⁴, ronde 3)": "d4_b2.5_L20"}
cur = None; pulls = []
for r in t4:
    if r[0] != "idem":
        cur = MAP4.get(r[0])
    if cur is None:
        continue
    lm = re.match(r"(\d+\.\d+)\((\d+)\)", r[2]); lv = float(lm.group(1)); le = int(lm.group(2)) * 10.0 ** (-len(lm.group(1).split(".")[1]))
    for tt in (1, 2):
        f = P[cur]["glueball"]["fixed_t"][f"t{tt}"]
        pulls.append(((f["m"] - lv) / math.hypot(f["err"], le), cur, tt, r[2][:12]))
best = max(pulls)
print("         D=4 glueball pulls recomputed (t=1 and t=2, %d values): max %+.3f (%s, t=%d, against %s)" % (len(pulls), best[0], best[1], best[2], best[3]))
chk("row 7: largest D=4 glueball pull against a literature value", m.group(3), f"{best[0]:.1f}".replace(".", ","))
sp = [r["pull"]["t1"] for r in S["literature_comparison"]["rows"] if r["quantity"] == "a*m(0++)" and P[r["ensemble"]]["D"] == 4 and r["pull"]["t1"] is not None]
chk("row 7: same from summary.json literature_comparison (t=1 rows)", m.group(3), f"{max(sp):.1f}".replace(".", ","))
chk("row 7: REPORT.md §0 and §4.8 say 3,9σ", ("tot 3,9σ boven gepubliceerde roosterwaarden" in rep, "3,9σ boven 0.6857(28)" in rep), (True, True))
big24 = max(p for p in pulls if "b2.4" in p[1]); big25 = max(p for p in pulls if "b2.5" in p[1])
print("         largest pull at beta = 2.4: %+.2f, at beta = 2.5: %+.2f, at beta = 2.3: %+.2f" % (big24[0], big25[0], max(p for p in pulls if "b2.3" in p[1])[0]))

m8 = need(r"Het rapport bevat (\d+) verschillende getallen met een fout erbij\. (\d+) daarvan staan letterlijk in een projectbestand; voor (\d+) is alleen een los getal met "
          r"ongeveer dezelfde waarde in een resultaatbestand gevonden, en dat is geen sluitende herkomst \(het zijn vooral afgeleide getallen en getallen die uit een "
          r"controleverslag zijn overgenomen\); (\d+) zijn met de hand opgezocht in de testuitvoer\. Teruggevonden betekent voor de (\d+) en de (\d+) dat het getal een "
          r"aanwijsbare bron heeft, niet dat het opnieuw is uitgerekend", ver, "row 8")
m = m8
chk("row 8 (v3): 'voor de 257 en de 2' repeats the literal and by-hand counts", (m8.group(5), m8.group(6)), (m8.group(2), m8.group(4)))
tt_ = out("trace_tokens.txt")
mm = re.search(r"distinct tokens: (\d+)\s+untraced by literal/pool match: (\d+)", tt_)
pool = int(re.search(r"pool-only \(no literal string in any text source\): (\d+)", tt_).group(1))
chk("row 8: distinct tokens (trace_tokens.txt)", int(m.group(1)), int(mm.group(1)))
chk("row 8: by hand = untraced", int(m.group(4)), int(mm.group(2)))
chk("row 8: pool-only", int(m.group(3)), pool)
chk("row 8: literal = distinct - pool-only - untraced", int(m.group(2)), int(mm.group(1)) - pool - int(mm.group(2)))
chk("row 8: the three parts add up to the total", int(m.group(2)) + int(m.group(3)) + int(m.group(4)), int(m.group(1)))
chk("row 8: UNTRACED lines in the file", len(re.findall(r"UNTRACED", tt_)), int(mm.group(2)))
chk("row 8: pool-only lines listed in the file", len(re.findall(r"^   \d", tt_[tt_.index("pool-only"):], flags=re.M)), pool)
mine = {t.lstrip("-") for t in re.findall(r"-?\d+\.\d+\(\d+(?:\.\d+)?\)", rep)}
chk("row 8: distinct value(error) tokens in the current REPORT.md (own count)", int(m.group(1)), len(mine))
for tok in re.findall(r"UNTRACED (\S+)", tt_):
    v, e = re.match(r"([\d.]+)\((\d+)\)", tok).groups()
    val = float(v); err = int(e) * 10.0 ** (-len(v.split(".")[1]))
    nd = len(v.split(".")[1])
    hits = [(a, b) for a, b in re.findall(r"P = (\d\.\d+) \+- ([0-9.e-]+)", rp)
            if f"{float(a):.{nd}f}" == v and round(float(b) * 10 ** nd) == int(e)]
    chk(f"row 8: by-hand token {tok} is in the test output t_rP.txt as {hits}", len(hits) >= 1, True)

m = need(r"Bij het vooraf vastgelegde criterium van ronde 3 ligt de meting (\d+,\d)σ boven de voorspelling .*?; de drempel was (\d+)σ \(§4\.5\)", ver, "row 9")
c3 = out("check3.txt")
mm = re.search(r"t1 meas-A sigma: report ([0-9.]+)\s+computed ([0-9.]+)", c3)
chk("row 9: sigma (check3.txt, computed %s)" % mm.group(2), m.group(1), f"{float(mm.group(2)):.1f}".replace(".", ","))
r3s = S["round3"]
chk("row 9: sigma (summary.json round3.t1.measured_minus_A.sigma = %.4f)" % r3s["t1"]["measured_minus_A"]["sigma"], m.group(1), f"{r3s['t1']['measured_minus_A']['sigma']:.1f}".replace(".", ","))
chk("row 9: threshold (summary.json round3.criterion_sigma)", float(m.group(2)), r3s["criterion_sigma"])
chk("row 9: threshold in run_round3_production.sh, fixed before the data ('more than 3 sigma')", "lies more than 3 sigma (errors added in quadrature) above 0.6025" in rd("run_round3_production.sh"), True)
g20 = P["d4_b2.5_L20"]["glueball"]["fixed_t"]["t1"]; g16 = P["d4_b2.5_L16_combined"]["glueball"]["fixed_t"]["t1"]
A = g16["m"] * 16 / 20; dA = g16["err"] * 16 / 20
sig = (g20["m"] - A) / math.hypot(g20["err"], dA)
chk("row 9: sigma recomputed from results/d4_b2.5_L20.json and d4_b2.5_L16_combined.json (%.4f)" % sig, m.group(1), f"{sig:.1f}".replace(".", ","))
print("         own value: measured %.6f +- %.6f, prediction A = 16/20 x %.6f = %.6f +- %.6f, difference = %+.4f sigma" % (g20["m"], g20["err"], g16["m"], A, dA, sig))
chk("row 9: verdict in summary.json: reading A excluded", r3s["verdict"]["reading_A_excluded"], True)
chk("row 9: no MISMATCH/UNPARSABLE in check2.txt / check3.txt", len(re.findall(r"MISMATCH|UNPARSABLE", out("check2.txt") + c3)), 0)
chk("row 9: REPORT.md says 6,7σ for round 3", "bij β = 2,5 (6,7σ)" in rep, True)
# 'in vier dimensies past een constante niet' / 'de vooraf vastgelegde toets in drie dimensies slaagde niet'
c2 = out("check2.txt")
print("         check2.txt: D=4 'const chi2 R5' =", re.search(r"const chi2 R5: report (\S+)\s+computed (\S+)", c2).groups(),
      "; D=3 R5 constant chi2 =", re.search(r"^chi2: report (\S+)\s+computed (\S+)", c2, flags=re.M).groups(),
      " p =", re.search(r"^p: report (\S+)\s+computed (\S+)", c2, flags=re.M).groups())

print("\n================ VERIFICATION, rows 10-12 and the table as a whole")
nums = re.findall(r"(?:^| )(\d{1,2}) (?=Testsuite van de code|Exact bekende|Tweede simulatie|Tweede analyse|Herkomst van de ruwe|Tabellen tegen|Rekenwerk van de|Getallen in de|Rekenwerk van fits|Samenvatting|Bijlage B van|Tekst nagelopen)", ver)
chk("table: 12 numbered rows, 1..12 in order", [int(x) for x in nums], list(range(1, 13)))

print("\n================ 'WAT NIET BEVESTIGD IS'")
i0 = ver.index("Wat niet bevestigd is 1. Dat het millenniumprobleem"); i1 = ver.index("Kort gezegd")
chk("v3: heading 'In één zin' no longer in the PDF", "In één zin" in ver, False)
nb = ver[i0:i1]
items = re.findall(r"(?:^| )(\d)\. (?=Dat het millenniumprobleem is opgelost|Een oordeel van een mens|Dat de metingen een massakloof|Overeenstemming met gepubliceerde|Andere gevallen|Systematische fouten|Een deel van de controlegetallen|De nieuwsberichten)", nb)
chk("niet bevestigd: 8 items, 1..8", [int(x) for x in items], list(range(1, 9)))
m = need(r"bij β = 2,4 en 2,5 tot (\d+,\d)σ boven gepubliceerde roosterwaarden; dat verschil is niet verklaard \(§4\.8\)", nb, "item 4")
chk("item 4: 3,9σ = largest D=4 glueball pull (recomputed above)", m.group(1), f"{best[0]:.1f}".replace(".", ","))
chk("item 4: the pulls above 2σ are at beta 2.4 and 2.5 only (max at 2.3 is negative)", (big24[0] > 2, big25[0] > 2, max(p for p in pulls if "b2.3" in p[1])[0] < 0), (True, True, True))
m = need(r"niet beter begrensd dan ongeveer (\d+) tot (\d+) % in vier dimensies en (\d+) tot (\d+) % in drie \(§4\.7\)", nb, "item 6")
chk("item 6: percentages as in REPORT.md §4.7", m.groups(), re.search(r"niet beter dan ongeveer (\d+) tot (\d+) % in D = 4 en (\d+) tot (\d+) % in D = 3", rep).groups())
chk("item 6: percentages as in REPORT.md §6.1", m.groups(), re.search(r"niet beter begrensd dan ongeveer (\d+) tot (\d+) % \(D = 4\) en (\d+) tot (\d+) % \(D = 3\)", rep).groups())
lines = rep.split("\n")
def section_of(needle):
    cur = None
    for l in lines:
        mm_ = re.match(r"^### (\d\.\d)", l)
        if mm_: cur = mm_.group(1)
        if needle in l: return cur
chk("item 6: that sentence of the report is in §4.7", section_of("niet beter dan ongeveer 5 tot 10 % in D = 4"), "4.7")
need(r"De foutmarge van een getal volgens de vooraf vastgelegde regel R5 is bovendien te klein \(§2\)", nb, "item 6 (v3) wording")
chk("item 6: 'De foutmarge van een R5-getal is te klein (§2)': §2 of REPORT.md says so", "waardoor de opgegeven fout te klein is" in rep[rep.index("## 2. "):rep.index("## 3. ")], True)
need(r"de vooraf vastgelegde meting bij β = 9 kwam bij herhaling niet terug", nb, "item 3 beta 9")
need(r"alleen bij β = 2,4 en 2,5, telkens met maar twee doosgroottes", nb, "item 3 volumes")
vols = {}
for e in ind:
    if P[e]["D"] == 4: vols.setdefault(P[e]["beta"], set()).add(tuple(P[e]["shape"]))
chk("item 3: D=4 box sizes per beta (result files): two at 2.4 and 2.5, one at 2.3", {b: len(v) for b, v in sorted(vols.items())}, {2.3: 1, 2.4: 2, 2.5: 2})
# 'De massa in natuurlijke eenheden stijgt daar nog met beta': fixed t=1 ratios of the largest volumes
rr = [I[e]["ratios"]["m_over_sqrt_sigma"]["gevp"]["t1"]["nambu_goto"]["value"] for e in ("d4_b2.3_L10", "d4_b2.4_L16", "d4_b2.5_L20")]
chk("item 3: m/sqrt(sigma) at t=1 rises with beta on the largest D=4 lattices (%.3f, %.3f, %.3f)" % tuple(rr), rr[0] < rr[1] < rr[2], True)
need(r"Kort gezegd De meetuitkomsten in dit document kloppen met de opgeslagen data en het rekenwerk is nagelopen, door hetzelfde AI-systeem en door geen mens\. "
     r"Ze lossen het millenniumprobleem niet op en tonen geen massakloof aan\. Wat ze wel zeggen, staat in §0 en §5\.", ver, "Kort gezegd (v3)")

print("\n================ APPENDIX B, introduction (p. 28)")
m = need(r"voor elk van de (\d+) analyses de hoofduitkomsten: .*? de effectieve massa's bij t = 0 tot en met (\d+), .*? Het zijn (\d+) analyses van (\d+) roosters: "
         r"op twee roosters is twee keer gemeten, en van elk van die paren is er ook een samengevoegde analyse\. De runs van ronde 1 en 2 zijn op een vast "
         r"tijdsbudget gestopt, bij (\d+) tot (\d+) % van het ingestelde maximum aantal metingen", pB, "appendix B intro")
chk("B intro: analyses", (int(m.group(1)), int(m.group(3))), (len(ENS), len(ENS)))
need(r"de resultaatbestanden melden dat als waarschuwing\. Zo was het opgezet: het tijdsbudget bepaalde het aantal metingen; het ingestelde maximum was alleen een plafond \(§6\.2\)\.", pB, "B intro (v3) cap sentence")
chk("B intro (v3): REPORT.md §6.2 says each stream has a time budget (--maxtime) so that the number of measurements depends on the speed",
    "De productiescripts geven elke stroom een tijdsbudget (`--maxtime`), zodat het aantal metingen van de rekensnelheid afhangt" in rep[rep.index("### 6.2"):], True)
need(r"Staat er bij R5 \"geen plateau\", dan vond de regel geen vlak stuk; het getal dat erbij staat is dan alleen een bovengrens en telt niet als "
     r"meting\. \"Geen meting\" staat bij de grootheden die uit zo'n waarde zouden volgen \(§3\.2\)\. De toevoeging tussen rechte haken, bijvoorbeeld \[t\* = 1\], zegt bij welke t de regel de waarde heeft afgelezen\.", pB, "B intro (v3) R5 explanation")
chk("B intro: lattices", int(m.group(4)), len(lat))
bylat = {}
for e in ind: bylat.setdefault((P[e]["D"], P[e]["beta"], tuple(P[e]["shape"])), []).append(e)
twice = {k: v for k, v in bylat.items() if len(v) == 2}
chk("B intro: lattices measured twice", sorted(v for v in twice.values()), [["d3_b9.0_L24", "d3_b9.0_L24r"], ["d4_b2.5_L16", "d4_b2.5_L16x"]])
chk("B intro: 13 = 9 lattices + 2 repeats + 2 combined", len(lat) + len(twice) + len([e for e in ENS if e.endswith("_combined")]), len(ENS))
chk("B intro: largest t printed", int(m.group(2)), 6)
frac = []; nwarn = {}
for e in r12:
    ws = [w for w in P[e].get("warnings", []) if "reason: maxtime" in w]
    nwarn[e] = len(ws)
    for w in ws:
        q = re.search(r"_s(\d+)\.npz is an incomplete run \((\d+) of (\d+) measurements; reason: maxtime\)", w)
        st = {s["seed"]: s["n_meas"] for s in P[e]["streams"]}
        assert st[int(q.group(1))] == int(q.group(2)), (e, w)
        frac.append(int(q.group(2)) / int(q.group(3)))
chk("B intro: every one of the 40 streams of rounds 1 and 2 carries a 'maxtime' warning in its result file", (len(frac), set(nwarn.values())), (40, {4}))
chk("B intro: smallest fraction of the configured maximum (%.2f %%)" % (100 * min(frac)), int(m.group(5)), int(f"{100 * min(frac):.0f}"))
chk("B intro: largest fraction of the configured maximum (%.2f %%)" % (100 * max(frac)), int(m.group(6)), int(f"{100 * max(frac):.0f}"))
caps = {}
for fn in ("run_all_production.sh", "run_extra_production.sh"):
    for n, cap in re.findall(r'^\s*"(d[34]_b[\d.]+_L\d+\w*)\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|(\d+)\|', rd(fn), flags=re.M): caps[n] = int(cap)
f2 = [s["n_meas"] / caps[e] for e in r12 for s in P[e]["streams"]]
chk("B intro: same range from stream counts and the caps in the run scripts", (int(f"{100 * min(f2):.0f}"), int(f"{100 * max(f2):.0f}")), (int(m.group(5)), int(m.group(6))))
w3 = [w for e in r3 for w in P[e].get("warnings", []) if "maxtime" in w]
print("         round 3 (d4_b2.5_L20): %d maxtime warnings; streams %s of cap 2400" % (len(w3), [s["n_meas"] for s in P["d4_b2.5_L20"]["streams"]]))
m = need(r"Notatie: (\S+) betekent (\d,\d+) ± (\d,\d+), alleen de statistische fout", pB, "B notation")
chk("B intro: notation example is consistent", (m.group(1), m.group(2), m.group(3)), ("0.7263(125)", "0,7263", "0,0125"))
g = P["d4_b2.5_L20"]["glueball"]["fixed_t"]["t1"]
chk("B intro: 0.7263(125) is a real result (d4_b2.5_L20, glueball t=1: %.6f +- %.6f)" % (g["m"], g["err"]), f"{g['m']:.4f}({round(g['err'] * 1e4)})", "0.7263(125)")
m = need(r"\(hier (\S+), daar (\S+)\); het is hetzelfde getal, anders afgerond\. Een fout met een punt erin, zoals (\S+), betekent (\d,\d) ± (\d,\d)", pB, "B example")
g = P["d3_b6.0_L16"]["glueball"]["fixed_t"]["t2"]
chk("B intro: example 'hier' = d3_b6.0_L16 glueball t=2 with a two-digit error (%.6f +- %.6f)" % (g["m"], g["err"]), m.group(1), f"{g['m']:.3f}({round(g['err'] * 1e3)})")
chk("B intro: example 'daar' = the same number with a three-digit error", m.group(2), f"{g['m']:.4f}({round(g['err'] * 1e4)})")
allpages = norm(" ".join(" ".join(pages).split()))
body = norm(flat(*range(5, 27))); appB = norm(flat(*range(28, 41)))
chk("B intro: 1.203(26) occurs in appendix B and not in the report body", (appB.count("1.203(26)") > 0, body.count("1.203(26)")), (True, 0))
chk("B intro: 1.2035(259) occurs in the report body and not in appendix B", (body.count("1.2035(259)") > 0, appB.count("1.2035(259)")), (True, 0))
chk("B intro: example with a point in the error", (m.group(3), m.group(4), m.group(5)), ("1.1(1.4)", "1,1", "1,4"))
chk("B intro: 1.1(1.4) occurs in appendix B", appB.count("1.1(1.4)") > 0, True)
need(r"de fout bij t = 2 is twee tot drie keer zo groot \(§4\.7\)", pB, "B t=2 error")
rat = {e: P[e]["glueball"]["fixed_t"]["t2"]["err"] / P[e]["glueball"]["fixed_t"]["t1"]["err"] for e in ENS}
print("         glueball err(t=2)/err(t=1) over the 13 analyses: %.2f .. %.2f   (REPORT.md §4.7: '2 tot 3 keer groter')" % (min(rat.values()), max(rat.values())))
chk("B intro: err(t=2)/err(t=1) of the glueball rounds to 2 or 3 for all 13 analyses", sorted({round(v) for v in rat.values()}) in ([2, 3], [2], [3]), True)

print("\n================ APPENDIX C (p. 42)")
m = need(r"zijn die van git-commit (\w+) op de branch (\S+) ?\.", pC, "appendix C commit")
chk("C: commit = commit on the title page", m.group(1), commit)
chk("C: branch = current branch", m.group(2), git("rev-parse", "--abbrev-ref", "HEAD"))
chk("C: that commit is an ancestor of the branch head", subprocess.run(["git", "merge-base", "--is-ancestor", m.group(1), "HEAD"], cwd=ROOT).returncode, 0)
later = git("log", "--format=%h", m.group(1) + "..HEAD", "--", "review/numcheck/out_final", "pdf")
chk("C: review/numcheck/out_final/ and pdf/ were added after that commit", (bool(later), git("ls-tree", "-r", "--name-only", m.group(1), "--", "review/numcheck/out_final", "pdf")), (True, ""))
print("         REPORT.pdf in git: %r (status: %r)" % (git("ls-files", "REPORT.pdf"), git("status", "--porcelain", "--", "REPORT.pdf")))
sha = lambda path: hashlib.sha256(open(os.path.join(ROOT, path), "rb").read()).hexdigest()
def sha_git(path):
    blob = subprocess.run(["git", "show", f"{m.group(1)}:./{path}"], cwd=ROOT, capture_output=True).stdout
    return hashlib.sha256(blob).hexdigest()
nfp = 0; okfp = 0; okgit = 0
for e in ENS:
    q = need(re.escape(e) + r" ([0-9a-f]{16}) ([0-9a-f]{16})(?: |$)", pC, f"fingerprints of {e}")
    for path, printed_fp in ((f"results/{e}.json", q.group(1)), (f"results/independent/{e}.json", q.group(2))):
        nfp += 1; okfp += printed_fp == sha(path)[:16]; okgit += printed_fp == sha_git(path)[:16]
for path in ("REPORT.md", "literature.json", "results/summary.json", "results/independent/COMPARISON.md"):
    q = need(re.escape(path) + r" ([0-9a-f]{16})(?: |$)", pC, f"fingerprint of {path}")
    nfp += 1; okfp += q.group(1) == sha(path)[:16]; okgit += q.group(1) == sha_git(path)[:16]
chk("C: number of fingerprints printed (16 hex characters each)", (nfp, len(re.findall(r"\b[0-9a-f]{16}\b", pC))), (30, 30))
chk("C: fingerprints equal sha256 of the files on disk", okfp, 30)
chk("C: fingerprints equal sha256 of the files in commit %s (git show)" % m.group(1), okgit, 30)
need(r"Aan de tekst van REPORT\.md verandert het drie dingen: de titelregels vervallen .*? de bijlage van het rapport heet hier \"Bijlage A\", ook in de twee "
     r"verwijzingen ernaar; en de vier formules zijn als afbeelding gezet", pC, "C three edits")
chk("C: 'vier formules': $$ blocks in REPORT.md", len(re.findall(r"\n\$\$\n.*?\n\$\$\n", rep, flags=re.S)), 4)
chk("C: 'twee verwijzingen': references to the appendix in REPORT.md", (rep.count("de sleutel staat in de bijlage."), rep.count("(zie de bijlage)")), (1, 1))
mc = need(r"Een eerdere bouw van deze pdf \((\d+) pagina's\) is in (\w+) afzonderlijke controles nagelopen, alle drie door hetzelfde AI-systeem: de getallen tegen de bestanden, "
          r"elke pagina op opmaak, en de formulering van de nieuwe onderdelen\. Daarbij is geen fout getal gevonden\. Wel stond in bijlage B (\w+) waarde waar \"geen meting\" "
          r"hoort, en zeiden de nieuwe teksten op (\w+) plaatsen meer dan de controlebestanden dragen\. Die punten en (\w+) opmaakfouten zijn hersteld\.", pC, "C three reviews (v3)")
from pypdf import PdfReader as _PR
chk("C (v3): pages of the first build (REPORT_v1.pdf, pypdf)", int(mc.group(1)), len(_PR(QA + "/REPORT_v1.pdf").pages))
f1 = rd("review", "pdfcheck", "findings_v1.txt")
WORD = {"één": 1, "twee": 2, "drie": 3, "negen": 9, "tien": 10}
chk("C (v3): 'geen fout getal': findings_v1.txt, number review: 'No wrong number found'", "No wrong number found in REPORT_v1.pdf" in f1, True)
chk("C (v3): 'één waarde waar geen meting hoort': 732 of 733 appendix B checks, the one failure is the R5 ratio of d3_b6.0_L24",
    (WORD[mc.group(3)], bool(re.search(r"732 of 733 checks pass", f1)), "The one failure: d3_b6.0_L24 prints an R5 ratio 4.46(14) where the JSON says upper bound only" in f1), (1, True, True))
chk("C (v3): 'tien plaatsen': findings_v1.txt, wording review: 'in ten places'", (WORD[mc.group(4)], "say more than the evidence carries in ten places" in f1), (10, True))
chk("C (v3): 'negen opmaakfouten': findings_v1.txt, layout review: 'fixed 9 defects'", (WORD[mc.group(5)], "fixed 9 defects in pdf/style.css" in f1), (9, True))
chk("C (v3): 'drie' controls", WORD[mc.group(2)], 3)
chk("C (v3): that value is 'geen meting' in this build (appendix B, d3_b6.0_L24) and 4.46(14) is nowhere in the PDF", ("4.46(14)" in allpages, "m/√σ (Nambu–Goto) geen meting" in norm(flat(29))), (False, True))
need(r"of en hoe die bouw zelf nog is nagelopen, staat in review/pdfcheck/README\.md ?\. In dezelfde map staan de bevindingen van alle rondes", pC, "C (v3) pointer to README")
chk("C (v3): review/pdfcheck/findings_v2.txt exists (second round)", os.path.exists(os.path.join(ROOT, "review", "pdfcheck", "findings_v2.txt")), True)
need(r"python3 pdf/make_pdf\.py # schrijft REPORT\.pdf; nodig: pandoc, node met playwright, matplotlib, pypdf", pC, "C (v3) build command")
chk("C: 'drie afzonderlijke controles': REVIEW blocks in review/pdfcheck/findings_v1.txt", len(re.findall(r"^REVIEW: ", rd("review", "pdfcheck", "findings_v1.txt"), flags=re.M)), 3)

print()
print("front matter (%s): %d checks, %d OK, %d mismatches" % (SRC, len(res), sum(res), len(res) - sum(res)))
