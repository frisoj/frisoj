#!/usr/bin/env python3
"""Referee check for the corrected version of the second remark after Stelling A.

Claim proposed as replacement text: for a symmetric kernel with 0 < c <= T(u,u') <= C on a
probability space, every eigenvalue other than the top one satisfies
        |lambda| <= (1 - c/C) * lambda_0 .
(Doeblin argument for the Markov kernel Q(u,du') = T(u,u') Omega(u') du' / (lambda_0 Omega(u)).)
For Stelling A:  e^{-beta(|E|+|P_s|)} <= T(u,u') <= e^{beta(|E|+|P_s|)}, so this gives the explicit
but exponentially small bound  m >= -ln(1 - e^{-2 beta (|E|+|P_s|)}) >= e^{-2 beta (|E|+|P_s|)}.

Here: random symmetric positive matrices (uniform weights), generic and positive semidefinite.
The printed number must be <= 0.

Run:  python3 review/proofs/ref_a_doeblin_bound.py     (from yang-mills/)
"""
import numpy as np

rng = np.random.default_rng(5)
worst = -np.inf
tightest = None
ntest = 0
for trial in range(20000):
    n = int(rng.integers(2, 25))
    kind = trial % 3
    if kind == 0:                       # generic symmetric positive
        A = rng.uniform(0.01, 1.0, size=(n, n)) ** rng.uniform(0.2, 6.0)
        T = (A + A.T) / 2
    elif kind == 1:                     # positive semidefinite with positive entries
        B = rng.uniform(0.0, 1.0, size=(n, int(rng.integers(1, n + 1))))
        T = B @ B.T + 1e-3
    else:                               # e^{-V/2} K e^{-V/2} type
        x = rng.normal(size=(n, 2))
        K = np.exp(rng.uniform(0.1, 3.0) * (x @ x.T))
        v = np.exp(rng.normal(size=n))
        T = v[:, None] * K * v[None, :]
    ev = np.linalg.eigvalsh(T)
    lam0 = ev[-1]
    second = max(abs(ev[0]), abs(ev[-2]))
    slack = second / lam0 - (1 - T.min() / T.max())
    ntest += 1
    if slack > worst:
        worst, tightest = slack, (n, kind, second / lam0, 1 - T.min() / T.max())
print(f"{ntest} random symmetric positive matrices: max of |lambda_2|/lambda_0 - (1 - min T/max T) = {worst:.3e}  (must be <= 0)")
print(f"tightest case: n={tightest[0]}, kind={tightest[1]}, |lambda_2|/lambda_0={tightest[2]:.6f}, bound={tightest[3]:.6f}")
# the 2x2 matrix [[C,c],[c,C]] attains (C-c)/(C+c) < 1 - c/C
C, c = 1.0, 0.2
print(f"2x2 example [[C,c],[c,C]]: lambda_1/lambda_0 = {(C-c)/(C+c):.4f} <= 1 - c/C = {1-c/C:.4f}")
