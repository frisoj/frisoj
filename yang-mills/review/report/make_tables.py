"""Scratch helper for REPORT.md: prints Markdown tables and derived numbers from the project's
result files only (results/<ens>.json, results/summary.json, results/independent/<ens>.json).
Reads only; writes nothing into the project."""
import json
import math
import os

P = "/home/user/frisoj/yang-mills"
ORDER = ["d3_b6.0_L16", "d3_b6.0_L24", "d3_b9.0_L24", "d3_b9.0_L24r", "d3_b9.0_L24_combined",
         "d3_b12.0_L32", "d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.4_L16", "d4_b2.5_L16",
         "d4_b2.5_L16x", "d4_b2.5_L16_combined"]
pipe = {n: json.load(open(os.path.join(P, "results", n + ".json"))) for n in ORDER}
ind = {n: json.load(open(os.path.join(P, "results", "independent", n + ".json"))) for n in ORDER}
summ = json.load(open(os.path.join(P, "results", "summary.json")))


def f(v, e, dec):
    """value(error) with a fixed number of decimals."""
    return "%.*f(%d)" % (dec, v, int(round(e * 10 ** dec)))


def fa(v, e):
    """adaptive: two significant digits of the error."""
    if e <= 0:
        return "%g" % v
    dec = max(0, 1 - int(math.floor(math.log10(e))))
    return "%.*f(%d)" % (dec, v, int(round(e * 10 ** dec)))


def lat(p):
    s = p["shape"]
    if len(set(s)) == 1:
        return "%d^%d" % (s[0], len(s))
    return "%dx%d^%d" % (s[0], s[1], len(s) - 1)


def meff(p, ch, t):
    r = p[ch]["meff_table"][t]
    assert r["t"] == t
    return r["m_cosh"], r["err_cosh"]


def ng(p, t):
    for r in p["string_tension"]["fixed_t"]:
        if r["t"] == t:
            return r["nambu_goto"]["a_sqrt_sigma"], r["nambu_goto"]["a_sqrt_sigma_err"]
    raise KeyError


def lus(p, t):
    for r in p["string_tension"]["fixed_t"]:
        if r["t"] == t:
            return r["luscher"]["a_sqrt_sigma"], r["luscher"]["a_sqrt_sigma_err"]
    raise KeyError


def ratio_ind(n, t):
    r = ind[n]["ratios"]["m_over_sqrt_sigma"]["gevp"]["t%d" % t]["nambu_goto"]
    return r["value"], r["err_jack"], r["err_boot"]


print("== T1: glueball ==")
print("| ensemble | D | β | rooster | ronde | metingen | bins | a·m R5 [t*] | m_eff(1) | m_eff(2) |")
print("|---|---|---|---|---|---|---|---|---|---|")
for n in ORDER:
    p = pipe[n]
    g = p["glueball"]
    m1 = meff(p, "glueball", 1)
    m2 = meff(p, "glueball", 2)
    assert abs(g["fixed_t"]["t1"]["m"] - m1[0]) < 1e-12 and abs(g["fixed_t"]["t2"]["m"] - m2[0]) < 1e-12
    print("| %s | %d | %g | %s | %s | %d | %d | %s [%d] | %s | %s |" % (
        n, p["D"], p["beta"], lat(p), summ["ensembles"][n]["round"], p["n_meas_total"], p["n_bins"],
        f(g["mass"], g["err"], 4), g["t_star"], f(*m1, 4), f(*m2, 4)))

print("\n== T2: torelon, string tension, ratio ==")
print("| ensemble | L | torelon a·E R5 [t*] | a√σ R5 | a√σ t=1 | a√σ t=2 | m/√σ R5 | m/√σ t=1 | m/√σ t=2 |")
print("|---|---|---|---|---|---|---|---|---|")
for n in ORDER:
    p = pipe[n]
    t = p["torelon"]
    st = p["string_tension"]
    rr = p["ratios"]["m_over_sqrt_sigma"]["nambu_goto"]
    nopl = st["upper_bound_only"]
    r1 = ratio_ind(n, 1)
    r2 = ratio_ind(n, 2)
    if nopl:
        c_e = "geen plateau"
        c_s = "geen meting"
        c_r = "geen meting"
    else:
        c_e = "%s [%d]" % (f(t["mass"], t["err"], 4), t["t_star"])
        c_s = fa(st["nambu_goto"]["a_sqrt_sigma"], st["nambu_goto"]["a_sqrt_sigma_err"])
        c_r = f(rr["value"], rr["err"], 3)
    print("| %s | %d | %s | %s | %s | %s | %s | %s | %s |" % (
        n, st["L"], c_e, c_s, fa(*ng(p, 1)), fa(*ng(p, 2)), c_r, f(r1[0], r1[1], 3), f(r2[0], r2[1], 3)))
    print("      [jack/boot errs of fixed-t ratios: t1 %.4f/%.4f  t2 %.4f/%.4f ; pipeline R5 t_glue=%s t_tor=%s; luscher t1 %s t2 %s]" % (
        r1[1], r1[2], r2[1], r2[2], p["glueball"]["t_star"], t["t_star"], fa(*lus(p, 1)), fa(*lus(p, 2))))

print("\n== T3: volume indicators, correlation length, contamination ==")
print("| ensemble | L√σ (t=1) | a·m·L (t=1) | ξ/a = 1/(a·m) | a·E_torelon(1) | 2E_tor/m | lichtste: | [m(0)-m(1)]/m(1) |")
for n in ORDER:
    p = pipe[n]
    L = p["string_tension"]["L"]
    m0 = meff(p, "glueball", 0)
    m1 = meff(p, "glueball", 1)
    e1 = meff(p, "torelon", 1)
    s1 = ng(p, 1)
    xi = 1 / m1[0]
    print("| %s | %s | %s | %.2f | %s | %.2f | %s | %.1f %% |" % (
        n, f(L * s1[0], L * s1[1], 2), f(L * m1[0], L * m1[1], 2), xi, f(*e1, 4), 2 * e1[0] / m1[0],
        "torelon" if e1[0] < m1[0] else "glueball", 100 * (m0[0] - m1[0]) / m1[0]))


def wmean(pts):
    w = [1 / e ** 2 for _, e in pts]
    m = sum(wi * v for wi, (v, _) in zip(w, pts)) / sum(w)
    chi2 = sum(((v - m) / e) ** 2 for v, e in pts)
    return m, 1 / math.sqrt(sum(w)), chi2, len(pts) - 1


print("\n== m*L constant? (D=4) ==")
for label, names in (("ronde 1", ["d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.5_L16"]),
                     ("alle data", ["d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.5_L16_combined"])):
    pts = []
    for n in names:
        p = pipe[n]
        L = p["string_tension"]["L"]
        m1 = meff(p, "glueball", 1)
        pts.append((L * m1[0], L * m1[1]))
    m, e, c, d = wmean(pts)
    print(label, " ".join(f(v, er, 3) for v, er in pts), "-> const", f(m, e, 3), "chi2 %.2f/%d" % (c, d))
print("== m*L constant? (D=3, t=1) ==")
for label, names in (("ronde 1", ["d3_b6.0_L16", "d3_b9.0_L24", "d3_b12.0_L32"]),
                     ("alle data", ["d3_b6.0_L16", "d3_b9.0_L24_combined", "d3_b12.0_L32"])):
    pts = []
    for n in names:
        p = pipe[n]
        L = p["string_tension"]["L"]
        m1 = meff(p, "glueball", 1)
        pts.append((L * m1[0], L * m1[1]))
    m, e, c, d = wmean(pts)
    print(label, " ".join(f(v, er, 3) for v, er in pts), "-> const", f(m, e, 3), "chi2 %.2f/%d" % (c, d))

print("\n== 1/L prediction on the larger volume ==")
for a, b in (("d3_b6.0_L16", "d3_b6.0_L24"), ("d4_b2.4_L12", "d4_b2.4_L16")):
    ma = meff(pipe[a], "glueball", 1)
    mb = meff(pipe[b], "glueball", 1)
    La = pipe[a]["string_tension"]["L"]
    Lb = pipe[b]["string_tension"]["L"]
    pred = (ma[0] * La / Lb, ma[1] * La / Lb)
    z = (mb[0] - pred[0]) / math.hypot(mb[1], pred[1])
    ratio = mb[0] / ma[0]
    rerr = ratio * math.hypot(ma[1] / ma[0], mb[1] / mb[0])
    print("%s -> %s: a*m %s -> %s ; 1/L predicts %s ; measured is %.1f sigma away ; ratio %s (1/L: %.3f, z=%.1f); diff small-large %s = %.2f sigma ; rel. err of diff %.1f %%" % (
        a, b, f(*ma, 4), f(*mb, 4), f(*pred, 4), z, f(ratio, rerr, 3), La / Lb, (ratio - La / Lb) / rerr,
        f(ma[0] - mb[0], math.hypot(ma[1], mb[1]), 4), (ma[0] - mb[0]) / math.hypot(ma[1], mb[1]),
        100 * math.hypot(ma[1], mb[1]) / mb[0]))
    ea = meff(pipe[a], "torelon", 1)
    eb = meff(pipe[b], "torelon", 1)
    print("   torelon E(1): %s -> %s ; ratio %.3f vs L ratio %.3f" % (f(*ea, 4), f(*eb, 4), eb[0] / ea[0], Lb / La))

print("\n== D=3 constant fits of m/sqrt(sigma) (correlated jackknife ratios from results/independent) ==")
lit = (4.716, 0.021)


def fitline(label, pts):
    m, e, c, d = wmean(pts)
    print("  %-48s pts %s -> const %s chi2 %.2f/%d ; pull vs 4.716(21): %+.1f ; spread %.1f %%" % (
        label, " ".join(f(v, er, 3) for v, er in pts), f(m, e, 3), c, d, (m - lit[0]) / math.hypot(e, lit[1]),
        100 * (max(v for v, _ in pts) - min(v for v, _ in pts)) / (sum(v for v, _ in pts) / len(pts))))


R = lambda n, t: ratio_ind(n, t)[:2]
fitline("t=1, beta9 combined", [R("d3_b6.0_L16", 1), R("d3_b9.0_L24_combined", 1), R("d3_b12.0_L32", 1)])
fitline("t=1, beta9 replication only", [R("d3_b6.0_L16", 1), R("d3_b9.0_L24r", 1), R("d3_b12.0_L32", 1)])
fitline("t=1, beta9 round 1 only", [R("d3_b6.0_L16", 1), R("d3_b9.0_L24", 1), R("d3_b12.0_L32", 1)])
fitline("t=2, beta9 combined", [R("d3_b6.0_L16", 2), R("d3_b9.0_L24_combined", 2), R("d3_b12.0_L32", 2)])
fitline("t=2, beta9 replication only", [R("d3_b6.0_L16", 2), R("d3_b9.0_L24r", 2), R("d3_b12.0_L32", 2)])
fitline("t=1,2,2 (equal physical t), beta9 combined", [R("d3_b6.0_L16", 1), R("d3_b9.0_L24_combined", 2), R("d3_b12.0_L32", 2)])
fitline("t=1,2,2 (equal physical t), beta9 replication", [R("d3_b6.0_L16", 1), R("d3_b9.0_L24r", 2), R("d3_b12.0_L32", 2)])
a6 = ng(pipe["d3_b6.0_L16"], 1)[0]
a12 = ng(pipe["d3_b12.0_L32"], 1)[0]
print("  lattice-spacing ratio a(6)/a(12) from a*sqrt(sigma) t=1: %.3f ; t*a*sqrt(sigma) at t=1: %.3f %.3f %.3f" % (
    a6 / a12, a6, ng(pipe["d3_b9.0_L24_combined"], 1)[0], a12))

print("\n== D=4 m/sqrt(sigma) at t=1 everywhere and differences ==")
pts = [R("d4_b2.3_L10", 1), R("d4_b2.4_L12", 1), R("d4_b2.5_L16_combined", 1)]
m, e, c, d = wmean(pts)
print("  t=1: %s -> const chi2 %.1f/%d" % (" ".join(f(v, er, 3) for v, er in pts), c, d))
for la, A, lb, B in (("b2.5 comb t=1", R("d4_b2.5_L16_combined", 1), "b2.3 t=1", R("d4_b2.3_L10", 1)),
                     ("b2.5 comb t=2", R("d4_b2.5_L16_combined", 2), "b2.3 t=1", R("d4_b2.3_L10", 1)),
                     ("b2.5 comb t=1", R("d4_b2.5_L16_combined", 1), "b2.4 L12 t=1", R("d4_b2.4_L12", 1)),
                     ("b2.5 comb t=1", R("d4_b2.5_L16_combined", 1), "b2.4 L16 t=1", R("d4_b2.4_L16", 1)),
                     ("b2.4 L12 t=1", R("d4_b2.4_L12", 1), "b2.3 t=1", R("d4_b2.3_L10", 1))):
    dd = A[0] - B[0]
    ee = math.hypot(A[1], B[1])
    print("  %s minus %s: %+.3f(%d) = %.1f sigma" % (la, lb, dd, round(ee * 1000), dd / ee))
print("  t*a*sqrt(sigma) at t=1: %.3f %.3f %.3f ; a(2.3)/a(2.5) = %.3f" % (
    ng(pipe["d4_b2.3_L10"], 1)[0], ng(pipe["d4_b2.4_L12"], 1)[0], ng(pipe["d4_b2.5_L16_combined"], 1)[0],
    ng(pipe["d4_b2.3_L10"], 1)[0] / ng(pipe["d4_b2.5_L16_combined"], 1)[0]))
# R5 ratios
r5 = [(pipe[n]["ratios"]["m_over_sqrt_sigma"]["nambu_goto"]["value"], pipe[n]["ratios"]["m_over_sqrt_sigma"]["nambu_goto"]["err"])
      for n in ("d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.5_L16_combined")]
dd = r5[2][0] - r5[0][0]
ee = math.hypot(r5[2][1], r5[0][1])
print("  R5: %s ; 2.5-2.3 = %.3f(%d) = %.1f sigma ; rel. rise %.1f %%" % (" ".join(f(v, er, 3) for v, er in r5), dd, round(ee * 1000), dd / ee, 100 * dd / r5[0][0]))

print("\n== literature pulls (own arithmetic; literature numbers from literature.json) ==")


def pull(v, e, lv, le):
    return (v - lv) / math.hypot(e, le)


for n, t in (("d4_b2.3_L10", 1), ("d4_b2.3_L10", 2), ("d4_b2.4_L12", 1), ("d4_b2.4_L12", 2), ("d4_b2.4_L16", 1), ("d4_b2.4_L16", 2),
             ("d4_b2.5_L16", 1), ("d4_b2.5_L16", 2), ("d4_b2.5_L16_combined", 1), ("d4_b2.5_L16_combined", 2)):
    m = meff(pipe[n], "glueball", t)
    lits = {"d4_b2.3": [(1.216, 0.023)], "d4_b2.4": [(0.936, 0.023)], "d4_b2.5": [(0.660, 0.022), (0.6857, 0.0028), (0.72, 0.03)]}[n[:7]]
    print("  %s m_eff(%d) %s : %s" % (n, t, f(*m, 4), " ; ".join("vs %s: %+.2f" % (fa(*l), pull(m[0], m[1], *l)) for l in lits)))
for n, lv in (("d4_b2.3_L10", (0.3687, 0.0022)), ("d4_b2.4_L12", (0.2673, 0.0015)), ("d4_b2.4_L12", (0.2660, 0.0021)),
              ("d4_b2.4_L16", (0.2660, 0.0021)), ("d4_b2.4_L16", (0.2673, 0.0015)),
              ("d4_b2.5_L16_combined", (0.1834, 0.0026)), ("d4_b2.5_L16_combined", (0.1871, 0.0010)), ("d4_b2.5_L16_combined", (0.186, 0.003)),
              ("d3_b6.0_L16", (0.2538, 0.0010)), ("d3_b6.0_L24", (0.2562, 0.0026)), ("d3_b9.0_L24_combined", (0.1616, 0.0006)),
              ("d3_b9.0_L24r", (0.1616, 0.0006)), ("d3_b9.0_L24", (0.1616, 0.0006)), ("d3_b12.0_L32", (0.1179, 0.0005))):
    for t in (1, 2):
        s = ng(pipe[n], t)
        l = lus(pipe[n], t)
        print("  %s a*sqrt(sigma) t=%d NG %s Luscher %s vs %s: %+.2f (NG) %+.2f (Luscher)" % (n, t, fa(*s), fa(*l), fa(*lv), pull(s[0], s[1], *lv), pull(l[0], l[1], *lv)))
for n, lv in (("d3_b6.0_L16", (1.19, 0.02)), ("d3_b9.0_L24", (0.765, 0.010)), ("d3_b9.0_L24r", (0.765, 0.010)), ("d3_b9.0_L24_combined", (0.765, 0.010)), ("d3_b12.0_L32", (0.559, 0.008))):
    for t in (1, 2):
        m = meff(pipe[n], "glueball", t)
        print("  %s m_eff(%d) %s vs %s [memory]: %+.2f" % (n, t, f(*m, 4), fa(*lv), pull(m[0], m[1], *lv)))
for n in ("d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.4_L16", "d4_b2.5_L16_combined"):
    p = pipe[n]
    print("  %s plaquette %s" % (n, fa(p["plaquette"]["mean"], p["plaquette"]["err"])))

print("\n== summary.json: literature rows with |pull| > 2 (any variant), chosen and alternatives ==")
for r in summ["literature_comparison"]["rows"]:
    vals = []
    for k in ("R5", "t1", "t2"):
        x = r.get("pull", {}).get(k) if isinstance(r.get("pull"), dict) else None
        vals.append(x)
    print("  ", {k: (v if not isinstance(v, float) else round(v, 3)) for k, v in r.items() if k in ("ensemble", "quantity", "lit_value", "lit_unc", "level", "chosen", "pull_R5", "pull_t1", "pull_t2", "pulls")}) if False else None
print(json.dumps(summ["literature_comparison"]["rows"][0], indent=1)[:1500])
print(json.dumps(summ["literature_comparison"]["counts"], indent=1)[:2500])
