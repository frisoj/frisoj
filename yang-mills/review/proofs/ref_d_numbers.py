#!/usr/bin/env python3
"""Referee D (round 2) -- numbers in the passages of BEWIJZEN.md that were changed after round 1.

 * section 0 / 4.1: beta_0(D); the table (alpha, lower bound ln(1/alpha) "naar beneden afgerond");
 * section 4.1, paragraph after the table: -4 ln u(0.03), -3 ln u(0.03), 4/(3 pi);
 * section 5.3: alpha < 1/e in D = 4  <=>  beta < 0.0204; doubling of the correlation length;
 * section 3.4: norm of T/Lambda_0 minus the projection on Omega = (I_2/I_1)^L, and the continuum
   counterpart exp(-(3/8) g^2 l tau) = sup_{j>0} exp(-tau (g^2 l/2) j(j+1));
 * section 3.3 point 5: monotonicity in j of q_j(L) and q_j, and sup_j |q_j(L) - q_j| -> 0.

Run:  python3 review/proofs/ref_d_numbers.py      (from yang-mills/; < 1 s)
"""
import math

import numpy as np
from scipy.special import iv, ive


def floor4(x):
    return math.floor(x * 1e4) / 1e4


print("beta_0(D) = artanh(1/(6(D-1))):")
for D, doc in ((2, 0.1682), (3, 0.0835), (4, 0.0556)):
    b0 = math.atanh(1.0 / (6 * (D - 1)))
    alt = 0.5 * math.log((6 * D - 5) / (6 * D - 7))
    print(f"  D={D}: {b0:.6f} (= (1/2) ln((6D-5)/(6D-7)) = {alt:.6f}); document {doc}; rounded down: {floor4(b0) == doc}")

print("table of section 4.1 (alpha rounded to nearest, bound rounded down):")
rows = [(2, 0.05, 0.2998, 1.2048), (2, 0.10, 0.5980, 0.5141), (2, 0.15, 0.8933, 0.1128),
        (3, 0.02, 0.2400, 1.4272), (3, 0.05, 0.5995, 0.5116), (3, 0.08, 0.9580, 0.0429),
        (4, 0.01, 0.1800, 1.7148), (4, 0.03, 0.5398, 0.6164), (4, 0.05, 0.8993, 0.1061)]
allok = True
for D, beta, a_doc, b_doc in rows:
    alpha = 6 * (D - 1) * math.tanh(beta)
    bound = math.log(1 / alpha)
    ok = (abs(round(alpha, 4) - a_doc) < 1e-9) and (abs(floor4(bound) - b_doc) < 1e-9)
    allok &= ok
    print(f"  D={D} beta={beta:.2f}: alpha={alpha:.6f} (doc {a_doc}), ln(1/alpha)={bound:.6f} (doc {b_doc}) -> {ok}")
print("  all rows consistent:", allok)

u = lambda b: iv(2, b) / iv(1, b)
print(f"-4 ln u(0.03) = {-4 * math.log(u(0.03)):.3f} (doc 19,6);  -3 ln u(0.03) = {-3 * math.log(u(0.03)):.3f} (doc 14,7)")
print(f"4/(3 pi) = {4 / (3 * math.pi):.4f} (doc 0,42);  6(D-1) * 4 beta_0/(3 pi): "
      + ", ".join(f"D={D}: {6 * (D - 1) * 4 * math.atanh(1 / (6 * (D - 1))) / (3 * math.pi):.4f}" for D in (2, 3, 4)) + " (doc ~0,43)")
print(f"alpha(beta,4) < 1/e  <=>  beta < artanh(1/(18 e)) = {math.atanh(1 / (18 * math.e)):.5f} (doc 0,0204)")
print(f"doubling of 1/(a Lambda_L): 11 ln 2/(3 pi^2) = {11 * math.log(2) / (3 * math.pi ** 2):.4f} (doc ~0,26; exponential factor only)")
print(f"section 4.6: 3 ln(I1/I2)(0.1) = {3 * math.log(1 / u(0.1)):.3f} (doc 11,07), per link {math.log(1 / u(0.1)):.3f} (doc 3,689)")

print("section 3.4, norms:")
for beta in (0.5, 2.0, 10.0):
    for L in (3, 6):
        ratios = np.array([(iv(n, beta) / iv(1, beta)) ** L for n in range(2, 60)])
        assert np.all((np.diff(ratios) < 0) | (ratios[1:] == 0.0))      # strictly decreasing until underflow
        print(f"  beta={beta}, L={L}: sup_j>0 (I_(2j+1)/I_1)^L = {ratios.max():.6e} = (I_2/I_1)^L = {u(beta) ** L:.6e}")
g2l, tau = 1.7, 0.9
qs = np.array([math.exp(-tau * g2l / 2 * (n / 2) * (n / 2 + 1)) for n in range(1, 40)])
print(f"  continuum: sup_j>0 exp(-tau (g^2 l/2) j(j+1)) = {qs.max():.6f} = exp(-(3/8) g^2 l tau) = {math.exp(-0.375 * g2l * tau):.6f}")

print("section 3.3 point 5: operator-norm convergence sup_j |q_j(L) - q_j| (g = 1, l = 2, tau = 1, N = round(tau/a)):")
for L in (8, 32, 128, 512):
    a = 2.0 / L
    beta = 4.0 / a ** 2
    N = max(1, round(1.0 / a))
    qL = np.array([(ive(n, beta) / ive(1, beta)) ** (L * N) for n in range(1, 80)])
    q = np.array([math.exp(-(N * a) * (2.0 / 2) * ((n - 1) / 2) * ((n - 1) / 2 + 1)) for n in range(1, 80)])
    assert np.all(np.diff(qL) <= 0) and np.all(np.diff(q) <= 0)
    print(f"  L={L:4d}, beta={beta:10.1f}, N={N:4d}: sup_j |q_j(L) - exp(-N a E_j)| = {np.max(np.abs(qL - q)):.3e}")
