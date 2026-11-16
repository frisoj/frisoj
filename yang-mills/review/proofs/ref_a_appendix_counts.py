#!/usr/bin/env python3
"""Referee check of small factual claims in section 1 and the appendix of BEWIJZEN.md.

  * (R1), (R2): every link lies in exactly 2(D-1) plaquettes; sum_{k != l} n_{lk} = 6(D-1);
    the four links of a plaquette are distinct (lattices with all sizes >= 3).
  * (S5): integration formula for class functions and orthonormality of characters (quadrature).
  * (S6): the listed identities for modified Bessel functions I_n (scipy.special.iv).

Run:  python3 review/proofs/ref_a_appendix_counts.py     (from yang-mills/)
"""
import itertools
from math import factorial

import numpy as np
from scipy.integrate import quad
from scipy.special import iv, ivp


def lattice(shape):
    D = len(shape)
    sites = list(itertools.product(*[range(k) for k in shape]))
    def shift(s, mu):
        s = list(s); s[mu] = (s[mu] + 1) % shape[mu]; return tuple(s)
    plaq = []
    for s in sites:
        for mu in range(D):
            for nu in range(mu + 1, D):
                plaq.append(((s, mu), (shift(s, mu), nu), (shift(s, nu), mu), (s, nu)))
    links = [(s, mu) for s in sites for mu in range(D)]
    return links, plaq


print("== (R1), (R2) ==")
for shape in [(3, 3), (3, 4), (3, 3, 3), (3, 4, 5), (3, 3, 3, 3), (2, 2), (2, 3, 3)]:
    links, plaq = lattice(shape)
    D = len(shape)
    distinct = all(len(set(p)) == 4 for p in plaq)
    count = {l: 0 for l in links}
    nlk = {}
    for p in plaq:
        for l in p:
            count[l] += 1
        for l in p:
            for k in p:
                if l != k:
                    nlk[(l, k)] = nlk.get((l, k), 0) + 1
    sums = {l: 0 for l in links}
    for (l, k), v in nlk.items():
        sums[l] += v
    print(f"   shape {shape}: 4 links distinct: {distinct}; plaquettes per link: {set(count.values())} (2(D-1) = {2*(D-1)});"
          f" sum_k n_lk: {set(sums.values())} (6(D-1) = {6*(D-1)}); max n_lk = {max(nlk.values())}")

print("== (S5) class functions: (2/pi) int_0^pi chi_j chi_k sin^2 = delta_jk ==")
chi = lambda n, th: np.sin(n * th) / np.sin(th)          # n = 2j+1
worst = 0.0
for n in range(1, 7):
    for m in range(1, 7):
        val = quad(lambda th: 2 / np.pi * np.sin(n * th) * np.sin(m * th), 0, np.pi)[0]
        worst = max(worst, abs(val - (1.0 if n == m else 0.0)))
print(f"   max deviation from orthonormality for 2j+1, 2k+1 <= 6: {worst:.1e}")

print("== (S6) Bessel identities, n = 0..6, x in {0.3, 1, 2.3, 7} ==")
w = dict(series=0.0, integral=0.0, recurrence=0.0, deriv1=0.0, deriv2=0.0)
for n in range(0, 7):
    for x in (0.3, 1.0, 2.3, 7.0):
        ser = sum((x / 2) ** (2 * k + n) / (factorial(k) * factorial(k + n)) for k in range(60))
        w["series"] = max(w["series"], abs(ser / iv(n, x) - 1))
        integ = quad(lambda th: np.exp(x * np.cos(th)) * np.cos(n * th) / np.pi, 0, np.pi)[0]
        w["integral"] = max(w["integral"], abs(integ / iv(n, x) - 1))
        if n >= 1:
            w["recurrence"] = max(w["recurrence"], abs(iv(n - 1, x) - iv(n + 1, x) - 2 * n / x * iv(n, x)) / iv(n, x))
        w["deriv1"] = max(w["deriv1"], abs(ivp(n, x) - (iv(n + 1, x) + n / x * iv(n, x))) / iv(n, x))
        w["deriv2"] = max(w["deriv2"], abs(ivp(n, x) - (iv(abs(n - 1), x) - n / x * iv(n, x))) / iv(n, x))
print("   max relative errors: " + ", ".join(f"{k}: {v:.1e}" for k, v in w.items()))
for n in (1, 2, 5):
    row = []
    for x in (50.0, 100.0, 200.0, 400.0):
        lead = np.exp(x) / np.sqrt(2 * np.pi * x) * (1 - (4 * n * n - 1) / (8 * x))
        row.append((iv(n, x) / lead - 1) * x * x)
    print(f"   asymptotics n={n}: x^2 * (I_n/[e^x/sqrt(2 pi x)(1-(4n^2-1)/(8x))] - 1) at x=50,100,200,400: "
          + ", ".join(f"{r:.4f}" for r in row) + f"   (expected limit (4n^2-1)(4n^2-9)/128 = {(4*n*n-1)*(4*n*n-9)/128:.4f})")
