"""Scratch: derived indicators for REPORT.md table 3, from results/<ens>.json only (read only).
Errors: simple propagation; ratios of glueball and torelon quantities are treated as uncorrelated."""
import json, math
P = "/home/user/frisoj/yang-mills/results/"
ORDER = ["d3_b6.0_L16", "d3_b6.0_L24", "d3_b9.0_L24", "d3_b9.0_L24r", "d3_b9.0_L24_combined",
         "d3_b12.0_L32", "d4_b2.3_L10", "d4_b2.4_L12", "d4_b2.4_L16", "d4_b2.5_L16",
         "d4_b2.5_L16x", "d4_b2.5_L16_combined"]
def f(v, e, dec):
    return "%.*f(%d)" % (dec, v, int(round(e * 10 ** dec)))
tot = 0
for n in ORDER:
    p = json.load(open(P + n + ".json"))
    g = p["glueball"]["meff_table"]; t = p["torelon"]["meff_table"]
    m0, e0 = g[0]["m_cosh"], g[0]["err_cosh"]; m1, e1 = g[1]["m_cosh"], g[1]["err_cosh"]
    E1, eE = t[1]["m_cosh"], t[1]["err_cosh"]
    L = p["torelon"]["L"]
    st = [r for r in p["string_tension"]["fixed_t"] if r["t"] == 1][0]["nambu_goto"]
    s, es = st["a_sqrt_sigma"], st["a_sqrt_sigma_err"]
    xi, exi = 1 / m1, e1 / m1 ** 2
    r, er = 2 * E1 / m1, 2 * E1 / m1 * math.hypot(eE / E1, e1 / m1)
    c, ec = (m0 - m1) / m1, math.hypot(e0, e1 * m0 / m1) / m1
    print("| %s | %s | %s | %s | %s | %s | %.1f(%.1f) %% |" % (
        n, f(L * s, L * es, 2), f(L * m1, L * e1, 2), f(xi, exi, 3), f(r, er, 2),
        "torelon" if E1 < m1 else "glueball", 100 * c, 100 * ec))
    if "combined" not in n: tot += p["n_meas_total"]
print("total measurements over the 10 independent data sets:", tot)
# D=4 quantities used in the text
J = lambda n: json.load(open(P + n + ".json"))
a, b = J("d4_b2.4_L12")["glueball"]["meff_table"][1], J("d4_b2.4_L16")["glueball"]["meff_table"][1]
pred = a["m_cosh"] * 12 / 16; epred = a["err_cosh"] * 12 / 16
print("1/L prediction beta 2.4 L16: %s ; measured %s ; z = %.2f" % (f(pred, epred, 4), f(b["m_cosh"], b["err_cosh"], 4),
      (b["m_cosh"] - pred) / math.hypot(epred, b["err_cosh"])))
c = J("d4_b2.5_L16_combined")["glueball"]["meff_table"][1]
print("round-3 reading A: %s" % f(c["m_cosh"] * 16 / 20, c["err_cosh"] * 16 / 20, 4))
print("beta 2.5 point vs 3.78(7): %.2f" % ((4.036 - 3.78) / math.hypot(0.087, 0.07)))
for lit, el in ((0.936, 0.023),):
    for nm in ("d4_b2.4_L12", "d4_b2.4_L16"):
        m = J(nm)["glueball"]["meff_table"][1]["m_cosh"]; print(nm, "ratio to lit %.3f" % (m / lit))
for lit in (0.660, 0.6857, 0.72):
    print("b2.5 combined / %.4f = %.3f" % (lit, c["m_cosh"] / lit))
print("lit rise 2.3->2.5: %.3f +- %.3f" % (3.599 - 3.298, math.hypot(0.065, 0.130)))
print("ours/lit rise: %.2f" % (0.710 / 0.301))
print("drop fractions b2.5: %.1f %% and %.1f %%" % (100 * 319 / 5831, 100 * 357 / 4871))
print("const 4.742..4.816 over 4.716: %.2f %% .. %.2f %%" % (100 * (4.742 / 4.716 - 1), 100 * (4.816 / 4.716 - 1)))
print("0.2619(11) vs 0.2673(15): %.2f" % ((0.2619 - 0.2673) / math.hypot(0.0011, 0.0015)))
print("0.72(3) vs 0.660(22): %.2f sigma" % ((0.72 - 0.66) / math.hypot(0.03, 0.022)))
print("L20 * a sqrt(sigma) = %.2f" % (20 * 0.1866))
