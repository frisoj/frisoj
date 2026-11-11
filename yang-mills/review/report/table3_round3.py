"""Round 3: the derived numbers quoted in REPORT.md for d4_b2.5_L20, from results/*.json only.

Same formulas as table3.py (simple propagation; glueball and torelon treated as uncorrelated).
Run from the project directory:  python3 review/report/table3_round3.py
"""
import json, math, os
P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "results")
J = lambda n: json.load(open(os.path.join(P, n + ".json")))
def f(v, e, dec):
    return "%.*f(%d)" % (dec, v, int(round(e * 10 ** dec)))
def row(n):
    p = J(n)
    g = p["glueball"]["meff_table"]; t = p["torelon"]["meff_table"]
    m0, e0 = g[0]["m_cosh"], g[0]["err_cosh"]; m1, e1 = g[1]["m_cosh"], g[1]["err_cosh"]
    E1, eE = t[1]["m_cosh"], t[1]["err_cosh"]
    L = p["torelon"]["L"]
    st = [r for r in p["string_tension"]["fixed_t"] if r["t"] == 1][0]["nambu_goto"]
    s, es = st["a_sqrt_sigma"], st["a_sqrt_sigma_err"]
    xi, exi = 1 / m1, e1 / m1 ** 2
    r, er = 2 * E1 / m1, 2 * E1 / m1 * math.hypot(eE / E1, e1 / m1)
    c, ec = (m0 - m1) / m1, math.hypot(e0, e1 * m0 / m1) / m1
    return "| %s | %s | %s | %s | %s | %s | %.1f(%.1f) %% |" % (
        n, f(L * s, L * es, 2), f(L * m1, L * e1, 2), f(xi, exi, 3), f(r, er, 2),
        "torelon" if E1 < m1 else "glueball", 100 * c, 100 * ec)
print("table 3 rows (L sqrt(sigma) | a m L | 1/(a m) | 2 E_tor/m | lightest | [m(0)-m(1)]/m(1))")
for n in ("d4_b2.5_L16_combined", "d4_b2.5_L20"):
    print(row(n))
def m(n, t):
    x = J(n)["glueball"]["meff_table"][t]; return x["m_cosh"], x["err_cosh"]
def z(a, ea, b, eb): return (a - b) / math.hypot(ea, eb)
ref, new = "d4_b2.5_L16_combined", "d4_b2.5_L20"
for t in (1, 2):
    (a, ea), (b, eb) = m(ref, t), m(new, t)
    pa, epa = a * 16 / 20, ea * 16 / 20
    q = -math.log(b / a) / math.log(20 / 16); eq = math.hypot(ea / a, eb / b) / math.log(20 / 16)
    print("t=%d: L16 %s  reading A %s  measured %s  measured-A %+.4f(%d) = %+.2f sigma  "
          "measured-L16 %+.4f(%d) = %+.2f sigma  q = %.2f(%d)" % (
              t, f(a, ea, 4), f(pa, epa, 4), f(b, eb, 4), b - pa, round(1e4 * math.hypot(eb, epa)),
              z(b, eb, pa, epa), b - a, round(1e4 * math.hypot(ea, eb)), z(b, eb, a, ea), q, round(100 * eq)))
print("literature pulls of d4_b2.5_L20 a*m (t=1 / t=2):")
for lit, el in ((0.660, 0.022), (0.6857, 0.0028), (0.72, 0.03), (0.69, 0.04)):
    print("  %.4f(%g): %+.2f / %+.2f" % (lit, el, z(*m(new, 1), lit, el), z(*m(new, 2), lit, el)))
st = {int(r["t"]): r["nambu_goto"] for r in J(new)["string_tension"]["fixed_t"]}
print("a sqrt(sigma) NG t=1 %s, t=2 %s" % (f(st[1]["a_sqrt_sigma"], st[1]["a_sqrt_sigma_err"], 4),
                                           f(st[2]["a_sqrt_sigma"], st[2]["a_sqrt_sigma_err"], 4)))
for lit, el in ((0.1834, 0.0026), (0.1871, 0.0010), (0.1905, 0.0008)):
    print("  a sqrt(sigma) vs %.4f(%g): %+.2f / %+.2f" % (
        lit, el, z(st[1]["a_sqrt_sigma"], st[1]["a_sqrt_sigma_err"], lit, el),
        z(st[2]["a_sqrt_sigma"], st[2]["a_sqrt_sigma_err"], lit, el)))
# m/sqrt(sigma) at fixed t = 1 (correlated jackknife errors from results/independent/*.json)
I = lambda n: json.load(open(os.path.join(P, "independent", n + ".json")))["ratios"]["m_over_sqrt_sigma"]["gevp"]
def rt(n, t="t1"):
    x = I(n)[t]["nambu_goto"]; return x["value"], x["err_jack"]
names = ("d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.4_L16", "d4_b2.5_L16_combined", "d4_b2.5_L20")
print("m/sqrt(sigma) t=1:", ", ".join("%s %s" % (n, f(*rt(n), 3)) for n in names))
print("m/sqrt(sigma) t=2:", ", ".join("%s %s" % (n, f(*rt(n, "t2"), 3)) for n in names))
lv = ("d4_b2.3_L10", "d4_b2.4_L16", "d4_b2.5_L20")
y = [rt(n)[0] for n in lv]; e = [rt(n)[1] for n in lv]
w = [1 / x ** 2 for x in e]; mean = sum(a * b for a, b in zip(w, y)) / sum(w)
print("largest volumes, t=1: constant %.3f(%d), chi2 = %.1f / 2" % (
    mean, round(1000 / math.sqrt(sum(w))), sum(((a - mean) / b) ** 2 for a, b in zip(y, e))))
for a, b in (("d4_b2.3_L10", "d4_b2.4_L16"), ("d4_b2.4_L16", "d4_b2.5_L20"), ("d4_b2.3_L10", "d4_b2.5_L20"),
             ("d4_b2.5_L16_combined", "d4_b2.5_L20"), ("d4_b2.4_L12", "d4_b2.5_L20")):
    (x, ex), (yy, ey) = rt(a), rt(b)
    print("  %s -> %s: %+.3f(%d), %+.1f sigma" % (a, b, yy - x, round(1000 * math.hypot(ex, ey)), z(yy, ey, x, ex)))
print("d4_b2.5_L20 t=1 vs 3.78(7): %+.2f sigma" % z(*rt(new), 3.78, 0.07))
tot = sum(J(n)["n_meas_total"] for n in ("d3_b6.0_L16", "d3_b6.0_L24", "d3_b9.0_L24", "d3_b9.0_L24r",
          "d3_b12.0_L32", "d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.4_L16", "d4_b2.5_L16", "d4_b2.5_L16x", "d4_b2.5_L20"))
print("total measurements over the 11 independent data sets:", tot)
print("a*m*L:", ", ".join("%s %s" % (n, f(J(n)["torelon"]["L"] * m(n, 1)[0], J(n)["torelon"]["L"] * m(n, 1)[1], 2)) for n in names))
