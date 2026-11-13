#!/usr/bin/env python3
"""Appendix B of REPORT_v4.pdf against results/<ens>.json and results/independent/<ens>.json.
Works from the PDF text only (pdftotext -layout, second pass with pdfplumber)."""
import json, re, sys, os, math
from decimal import Decimal, ROUND_HALF_EVEN

ROOT = "/home/user/frisoj/yang-mills"
QA = "/tmp/claude-0/-home-user-frisoj/c2e79863-26e2-54ce-9b2d-e39a90258140/scratchpad/qa"
ENS = ["d3_b6.0_L16", "d3_b6.0_L24", "d3_b9.0_L24", "d3_b9.0_L24r", "d3_b9.0_L24_combined",
       "d3_b12.0_L32", "d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.4_L16", "d4_b2.5_L16", "d4_b2.5_L16x",
       "d4_b2.5_L16_combined", "d4_b2.5_L20"]

# v2: every extractor is read from a text file with one form feed between pages
#   (pdftotext -layout, pdfplumber, pypdf; written by extract_all.py). No private-use map any more.
mode = sys.argv[1] if len(sys.argv) > 1 else "pdftotext"
txt = open(sys.argv[2] if len(sys.argv) > 2 else os.path.join(QA, "numbers-v4", "pdf_layout.txt"), encoding="utf-8").read()
pages = txt.split("\f")

# appendix B = from the page with the heading "Bijlage B: alle uitslagen" (not the TOC) up to "Bijlage C"
start = [i for i, p in enumerate(pages) if "Bijlage B: de uitslagen per analyse" in p and "Inhoud" not in p][0]
end = [i for i, p in enumerate(pages) if "Bijlage C: vingerafdrukken" in p and "Inhoud" not in p][0]
footer = re.compile(r"^\s*Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs\s+pagina \d+ van \d+\s*$")
lines = []
for i in range(start, end):
    for ln in pages[i].split("\n"):
        if footer.match(ln):
            continue
        lines.append(ln)
text = "\n".join(lines)

TOK = r"-?\d+(?:\.\d+)?\(\d+(?:\.\d+)?\)"
n_ok = 0
n_bad = 0
bad = []
counts = {}


def note(kind):
    counts[kind] = counts.get(kind, 0) + 1


def ok(kind):
    global n_ok
    n_ok += 1
    note(kind)


def fail(ens, what, printed, expected):
    global n_bad
    n_bad += 1
    bad.append((ens, what, printed, expected))


def tok_match(tok, value, err):
    """printed token value(err) equals the JSON numbers after rounding to the printed digits."""
    m = re.fullmatch(r"(-?\d+(?:\.(\d+))?)\((\d+(?:\.\d+)?)\)", tok)
    if not m or value is None or err is None:
        return False, "unparsable or missing JSON"
    vs, dec, es = m.group(1), m.group(2) or "", m.group(3)
    nd = len(dec)
    q = Decimal(1).scaleb(-nd)
    pv = Decimal(vs)
    pe = Decimal(es) if "." in es else Decimal(es) * q
    jv = Decimal(repr(float(value))).quantize(q, rounding=ROUND_HALF_EVEN)
    je = Decimal(repr(float(err))).quantize(q, rounding=ROUND_HALF_EVEN)
    # tolerate a half-way tie in either direction
    good_v = (pv == jv) or abs(Decimal(repr(float(value))) - pv) <= q / 2
    good_e = (pe == je) or abs(Decimal(repr(float(err))) - pe) <= q / 2
    # format rule announced in the appendix: the error has two digits
    two = len(es.replace(".", "").lstrip("0")) == 2
    return (good_v and good_e), f"json {value!r} +- {err!r} -> {jv}({je})" + ("" if two else " [error not 2 digits]")


def check_tok(ens, what, tok, value, err, kind):
    good, msg = tok_match(tok, value, err)
    if good:
        ok(kind)
    else:
        fail(ens, what, tok, msg)
    # two-digit convention
    es = re.search(r"\(([\d.]+)\)", tok).group(1)
    if len(es.replace(".", "").lstrip("0")) != 2:
        fail(ens, what + " (format: error not two digits)", tok, "two-digit error")


def nl(x, nd):
    d = Decimal(repr(float(x))).quantize(Decimal(1).scaleb(-nd), rounding=ROUND_HALF_EVEN)
    return str(d).replace(".", ",").replace("-", "−")


def nl_ok(printed, x, nd):
    """printed Dutch decimal equals x rounded to nd digits (either tie direction)."""
    p = Decimal(printed.replace(",", ".").replace("−", "-"))
    return abs(Decimal(repr(float(x))) - p) <= Decimal(1).scaleb(-nd) / 2


SUP = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")


def lattice_label(shape):
    """16^3, 12x10^3 etc from the JSON shape (time first)."""
    shape = list(shape)
    if len(set(shape)) == 1:
        return f"{shape[0]}" + str(len(shape)).translate(SUP)
    T, rest = shape[0], shape[1:]
    assert len(set(rest)) == 1
    return f"{T}×{rest[0]}" + str(len(rest)).translate(SUP)


# split into blocks by heading
heads = [(m.start(), m.group(1)) for m in re.finditer(r"^\s*(d[34]_b[\d.]+_L\d+\w*): D = ", text, flags=re.M)]
found = [h[1] for h in heads]
print("mode:", mode)
print("analyses found in appendix B, in order:", found)
if found != ENS:
    fail("-", "set/order of analyses", found, ENS)
else:
    ok("analyses present")

summary = json.load(open(os.path.join(ROOT, "results", "summary.json")))
ROLES = {}

for k, (pos, name) in enumerate(heads):
    blk = text[pos:(heads[k + 1][0] if k + 1 < len(heads) else len(text))]
    flat = " ".join(blk.split())
    d = json.load(open(os.path.join(ROOT, "results", name + ".json")))
    ind = json.load(open(os.path.join(ROOT, "results", "independent", name + ".json")))
    if d["ensemble"] != name or ind["ensemble"] != name:
        fail(name, "ensemble name in JSON", d["ensemble"], name)

    # ---- heading
    m = re.match(r"(\S+): D = (\d), β = ([\d.,]+), rooster (\S+), ronde (\S+)", flat)
    if not m:
        fail(name, "heading", flat[:80], "parsable heading"); continue
    D, beta, lat, rnd = m.group(2), m.group(3), m.group(4), m.group(5)
    if int(D) == d["D"] == ind["D"]: ok("heading D")
    else: fail(name, "D", D, d["D"])
    # v2: beta is printed with a decimal comma (integer beta without decimals)
    beta_exp = str(int(d["beta"])) if float(d["beta"]).is_integer() else repr(float(d["beta"])).replace(".", ",")
    if "." not in beta and float(beta.replace(",", ".")) == d["beta"] == ind["beta"] and beta == beta_exp: ok("heading beta")
    else: fail(name, "beta", beta, d["beta"])
    if lat == lattice_label(d["shape"]) and d["shape"] == ind["shape"]: ok("heading lattice")
    else: fail(name, "lattice", lat, lattice_label(d["shape"]))
    # round: from summary.json if it stores one
    srnd = summary["ensembles"].get(name, {}).get("round")
    if srnd is not None:
        if str(srnd) == rnd: ok("heading round")
        else: fail(name, "round", rnd, srnd)
    else:
        note("heading round NOT in summary.json (checked separately)")

    # ---- info line
    m = re.search(r", ronde \S+ (.*?)\. Metingen: (\d+), waarvan (\d+) gebruikt in (\d+) bins van (\d+); langste autocorrelatietijd "
                  r"([\d,]+) metingen\. Stromen \(seed, start, aantal metingen\): (.*?)\. grootheid", flat)
    if not m:
        fail(name, "info line", flat[:200], "parsable"); continue
    role, nm, nu, nb, bs, tau, streams = m.groups()
    ROLES[name] = role
    for what, p, j in (("n_meas_total", nm, d["n_meas_total"]), ("n_meas_used", nu, d["n_meas_used"]),
                       ("n_bins", nb, d["n_bins"]), ("binsize", bs, d["binsize"])):
        if int(p) == j: ok(what)
        else: fail(name, what, p, j)
    # internal consistency of the JSON itself and with the independent file
    if d["n_bins"] * d["binsize"] != d["n_meas_used"] and not name.endswith("_combined"):
        # per-stream binning: used = sum over streams of floor(n/binsize)*binsize
        pass
    if sum(s["n_meas"] for s in d["streams"]) != d["n_meas_total"]:
        fail(name, "sum of stream n_meas vs n_meas_total", sum(s["n_meas"] for s in d["streams"]), d["n_meas_total"])
    else:
        ok("stream sum == total (JSON internal)")
    if ind["n_meas_total"] != d["n_meas_total"] or ind["n_bins"] != d["n_bins"] or ind["binsize"] != d["binsize"] \
            or ind["n_used"] != d["n_meas_used"]:
        fail(name, "independent n_meas/n_bins/binsize/n_used differ from pipeline",
             (ind["n_meas_total"], ind["n_used"], ind["n_bins"], ind["binsize"]),
             (d["n_meas_total"], d["n_meas_used"], d["n_bins"], d["binsize"]))
    else:
        ok("independent counts == pipeline counts")
    if nl_ok(tau, d["tau_int_max"], 1) and "," in tau and len(tau.split(",")[1]) == 1: ok("tau_int_max")
    else: fail(name, "tau_int_max", tau, d["tau_int_max"])
    st_items = re.findall(r"(\d+) \((warm|koud), (\d+)\)", streams)
    exp = [(str(s["seed"]), "warm" if s["start"] == "hot" else "koud", str(s["n_meas"])) for s in d["streams"]]
    assert all(s["start"] in ("hot", "cold") for s in d["streams"])
    if st_items == exp and len(re.findall(r"\(", streams)) == len(exp):
        for _ in exp: ok("stream seed/start/count")
    else:
        fail(name, "streams", st_items, exp)

    # ---- 5 x 3 table
    g, t, st = d["glueball"], d["torelon"], d["string_tension"]
    fx = {int(f["t"]): f for f in st["fixed_t"]}
    ratio = d["ratios"]["m_over_sqrt_sigma"]
    ir = ind["ratios"]["m_over_sqrt_sigma"]["gevp"]
    m = re.search(r"grootheid R5 \(vooraf vastgelegde regel\) vaste t = 1 vaste t = 2 (.*?) Plaquette:", flat)
    tbl = m.group(1)
    m = re.fullmatch(r"glueball a·m (.*?) torelon a·E \(L = (\d+)\) (.*?) a√σ \(Nambu–Goto\) (.*?) a√σ \(Lüscher\) (.*?) "
                     r"m/√σ \(Nambu–Goto\) (.*)", tbl)
    if not m:
        fail(name, "5x3 table", tbl, "parsable"); continue
    rg, Lt, rt, rng, rlu, rra = m.groups()
    if int(Lt) == t["L"] == st["L"]: ok("torelon L")
    else: fail(name, "torelon L", Lt, t["L"])

    def r5cell(ens, what, cells, block):
        """cells: text of the row; returns the remaining two tokens."""
        if block.get("plateau") and not block.get("upper_bound_only"):
            mm = re.fullmatch(rf"({TOK}) \[t\* = (\d+)\] ({TOK}) ({TOK})", cells)
            if not mm:
                fail(ens, what + " R5 (JSON: plateau)", cells, "value [t* = n] t1 t2"); return None
            check_tok(ens, what + " R5", mm.group(1), block["mass"], block["err"], "5x3 cell")
            if int(mm.group(2)) == block["t_star"]: ok("t_star")
            else: fail(ens, what + " t_star", mm.group(2), block["t_star"])
            if "geen plateau" in cells: fail(ens, what, cells, "no 'geen plateau' expected")
            else: ok("plateau wording")
            return mm.group(3), mm.group(4)
        mm = re.fullmatch(rf"geen plateau; ({TOK}) bij t = (\d+) is alleen een bovengrens ({TOK}) ({TOK})", cells)
        if not mm:
            fail(ens, what + " R5 (JSON: no plateau / upper bound only)", cells, "geen plateau; ..."); return None
        check_tok(ens, what + " R5 upper bound", mm.group(1), block["mass"], block["err"], "5x3 cell")
        if int(mm.group(2)) == block["t_value"]: ok("t_value")
        else: fail(ens, what + " t_value", mm.group(2), block["t_value"])
        ok("plateau wording")
        return mm.group(3), mm.group(4)

    for what, cells, block in (("glueball", rg, g), ("torelon", rt, t)):
        # JSON self-consistency of the flags
        if bool(block.get("plateau")) == bool(block.get("upper_bound_only")):
            fail(name, what + " JSON flags plateau/upper_bound_only inconsistent",
                 (block.get("plateau"), block.get("upper_bound_only")), "opposite")
        r = r5cell(name, what, cells, block)
        if r:
            check_tok(name, what + " t=1", r[0], block["fixed_t"]["t1"]["m"], block["fixed_t"]["t1"]["err"], "5x3 cell")
            check_tok(name, what + " t=2", r[1], block["fixed_t"]["t2"]["m"], block["fixed_t"]["t2"]["err"], "5x3 cell")

    for what, cells, key in (("a sqrt(sigma) NG", rng, "nambu_goto"), ("a sqrt(sigma) Luscher", rlu, "luscher")):
        parts = re.fullmatch(rf"(geen meting|{TOK}) ({TOK}) ({TOK})", cells)
        if not parts:
            fail(name, what, cells, "3 cells"); continue
        if st.get("upper_bound_only"):
            if parts.group(1) == "geen meting": ok("5x3 cell (geen meting)")
            else: fail(name, what + " R5 (JSON string_tension.upper_bound_only = true)", parts.group(1), "geen meting")
        else:
            if parts.group(1) == "geen meting": fail(name, what + " R5", "geen meting", "a value")
            else: check_tok(name, what + " R5", parts.group(1), st[key]["a_sqrt_sigma"], st[key]["a_sqrt_sigma_err"], "5x3 cell")
        check_tok(name, what + " t=1", parts.group(2), fx[1][key]["a_sqrt_sigma"], fx[1][key]["a_sqrt_sigma_err"], "5x3 cell")
        check_tok(name, what + " t=2", parts.group(3), fx[2][key]["a_sqrt_sigma"], fx[2][key]["a_sqrt_sigma_err"], "5x3 cell")
        # fixed_t aE must be the torelon fixed_t energy
        for tt in (1, 2):
            if abs(fx[tt]["aE"] - t["fixed_t"][f"t{tt}"]["m"]) > 1e-12:
                fail(name, f"string_tension.fixed_t[{tt}].aE vs torelon.fixed_t", fx[tt]["aE"], t["fixed_t"][f"t{tt}"]["m"])

    parts = re.fullmatch(rf"(geen meting|{TOK}) ({TOK}) ({TOK})", rra)
    if not parts:
        fail(name, "ratio row", rra, "3 cells")
    else:
        # the JSON flag for "upper bound only" of the ratio: look everywhere it can sit
        ub_inner = bool(ratio.get("upper_bound_only"))
        ub_outer = bool(d["ratios"].get("upper_bound_only"))
        ub = ub_inner or ub_outer or bool(st.get("upper_bound_only")) or bool(g.get("upper_bound_only"))
        if ub:
            if parts.group(1) == "geen meting": ok("5x3 cell (geen meting)")
            else:
                good, msg = tok_match(parts.group(1), ratio["nambu_goto"]["value"], ratio["nambu_goto"]["err"])
                fail(name, "m/sqrt(sigma) R5: JSON says upper bound only "
                     f"(ratios.upper_bound_only={d['ratios'].get('upper_bound_only')!r}, "
                     f"ratios.m_over_sqrt_sigma.upper_bound_only={ratio.get('upper_bound_only')!r}, "
                     f"string_tension.upper_bound_only={st.get('upper_bound_only')!r}); number itself "
                     f"{'matches' if good else 'DOES NOT match'} the JSON", parts.group(1), "geen meting")
        else:
            if parts.group(1) == "geen meting": fail(name, "m/sqrt(sigma) R5", "geen meting", "a value")
            else: check_tok(name, "m/sqrt(sigma) R5", parts.group(1), ratio["nambu_goto"]["value"], ratio["nambu_goto"]["err"], "5x3 cell")
        for tt, tok in ((1, parts.group(2)), (2, parts.group(3))):
            check_tok(name, f"m/sqrt(sigma) t={tt} (independent, err_jack)", tok,
                      ir[f"t{tt}"]["nambu_goto"]["value"], ir[f"t{tt}"]["nambu_goto"]["err_jack"], "5x3 cell")
            # independent central value must equal the quotient of the pipeline numbers
            q = g["fixed_t"][f"t{tt}"]["m"] / fx[tt]["nambu_goto"]["a_sqrt_sigma"]
            if abs(q - ir[f"t{tt}"]["nambu_goto"]["value"]) > 5e-7 * abs(q):
                fail(name, f"independent ratio t={tt} vs pipeline m/a sqrt(sigma)", ir[f"t{tt}"]["nambu_goto"]["value"], q)
            else:
                ok("independent ratio == pipeline quotient (central value)")

    # ---- plaquette line
    m = re.search(rf"Plaquette: ({TOK})\. Stromen onderling \(plaquette\): χ² = ([\d,]+) bij (\d+) vrijheidsgraden; "
                  rf"warme min koude starts: ([−\d,]+)σ\.", flat)
    if not m:
        fail(name, "plaquette line", flat[-600:], "parsable"); continue
    sc, pl = d["stream_consistency"], d["plaquette"]
    check_tok(name, "plaquette", m.group(1), pl["mean"], pl["err"], "plaquette")
    if nl_ok(m.group(2), sc["plaquette"]["chi2"], 1) and len(m.group(2).split(",")[1]) == 1: ok("chi2")
    else: fail(name, "chi2", m.group(2), sc["plaquette"]["chi2"])
    if int(m.group(3)) == sc["plaquette"]["dof"] == len(d["streams"]) - 1: ok("dof")
    else: fail(name, "dof", m.group(3), sc["plaquette"]["dof"])
    if nl_ok(m.group(4), sc["hot_minus_cold"]["pull"], 2) and len(m.group(4).split(",")[1]) == 2 \
            and (m.group(4).startswith("−") == (sc["hot_minus_cold"]["pull"] < 0)): ok("hot-cold pull")
    else: fail(name, "hot-cold pull", m.group(4), sc["hot_minus_cold"]["pull"])

    # ---- effective-mass table
    m = re.search(r"t glueball m_eff\(t\) torelon E_eff\(t\) (.*)$", flat)
    rows = re.findall(rf"(\d+) ({TOK}|–) ({TOK}|–)", m.group(1))
    rest = re.sub(rf"(\d+) ({TOK}|–) ({TOK}|–)", "", m.group(1)).strip()
    if rest:
        fail(name, "meff table: unparsed text", rest, "")
    gm = {r["t"]: r for r in g["meff_table"]}
    tm = {r["t"]: r for r in t["meff_table"]}

    def has(r):
        return r is not None and r.get("m_cosh") is not None and r.get("err_cosh") is not None \
            and math.isfinite(r["m_cosh"]) and math.isfinite(r["err_cosh"])
    exp_ts = [tt for tt in range(0, 7) if has(gm.get(tt)) or has(tm.get(tt))]
    got_ts = [int(r[0]) for r in rows]
    if got_ts == exp_ts: ok("meff rows present")
    else: fail(name, "meff table rows", got_ts, exp_ts)
    for tt, a, b in rows:
        tt = int(tt)
        for what, tok, tab in (("glueball", a, gm), ("torelon", b, tm)):
            r = tab.get(tt)
            if tok == "–":
                if has(r): fail(name, f"meff {what} t={tt}", "–", (r["m_cosh"], r["err_cosh"]))
                else: ok("meff cell (dash)")
            else:
                if not has(r): fail(name, f"meff {what} t={tt}", tok, "no value in JSON")
                else: check_tok(name, f"meff {what} t={tt}", tok, r["m_cosh"], r["err_cosh"], "meff cell")
    # which larger t exist in the JSON but are not printed
    extra = [tt for tt in sorted(set(gm) | set(tm)) if tt > 6 and (has(gm.get(tt)) or has(tm.get(tt)))]
    if extra:
        note(f"meff rows with data at t>6 in JSON, not printed")
        print(f"  {name}: JSON has finite m_eff at t = {extra} (not printed; table stops at t = 6)")
    # fixed-t columns must equal meff rows t=1,2 (same estimator)
    for what, block, tab in (("glueball", g, gm), ("torelon", t, tm)):
        for tt in (1, 2):
            if has(tab.get(tt)) and abs(tab[tt]["m_cosh"] - block["fixed_t"][f"t{tt}"]["m"]) > 1e-12:
                fail(name, f"JSON: {what} fixed_t t{tt} != meff_table m_cosh", block["fixed_t"][f"t{tt}"]["m"], tab[tt]["m_cosh"])

    # every value(error) token of the block was consumed by one of the checks?
    ntok = len(re.findall(TOK, flat))
    print(f"  {name}: {ntok} value(error) tokens in block")

print()
print("checks passed:", n_ok, " failed:", n_bad)
for k in sorted(counts):
    print(f"   {counts[k]:5d}  {k}")
for b in bad:
    print("MISMATCH", b)
