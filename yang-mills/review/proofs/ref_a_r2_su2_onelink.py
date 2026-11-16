#!/usr/bin/env python3
"""Referee round 2, Stelling A step 3 (BEWIJZEN.md sec. 2.4) for the real group SU(2):
deterministic quadrature on SU(2) = S^3 (no Monte Carlo).

Product rule on S^3 (Gauss-Chebyshev 2nd kind x Gauss-Legendre x uniform), exact for
polynomials of degree <= 23 in the matrix entries.  One link (|E| = 1), so C = G.

  1. sanity of the rule: int dg = 1, int g dg = 0 (used for Jensen: T_0 >= 1), int (Tr g)^2 = 1,
     int (Tr g)^4 = 2;  (1/2) Tr(u u'^dagger) = <a, a'> (quaternion scalar product).
  2. (G2): conj of a monomial in the matrix entries is +- a monomial (closure of the algebra
     under complex conjugation, needed for Stone-Weierstrass).
  3. formula (2.2):  <f, K f> = sum_n (beta/2)^n / n! sum_{I in J^n} |<Phi_I, f>|^2
     for complex test functions f (left side: double quadrature of the kernel; right side: the
     series, with the sum over sequences I grouped by multi-index alpha: n!/alpha! sequences each).
  4. spectrum of the one-link operator K (Nystrom): eigenvalues (2/beta) I_n(beta), n = 2j+1,
     with multiplicity n^2, all > 0  (K >= 0 and injective; for |E| links the eigenvalues are
     products of these).  Hilbert-Schmidt identity of S3: sum_n n^2 ((2/beta) I_n)^2 = int k^2 = I_1(2 beta)/beta.

Run:  python3 review/proofs/ref_a_r2_su2_onelink.py     (from yang-mills/; about 20 s)
"""
import itertools
from math import factorial

import numpy as np
from scipy.special import iv


def s3_rule(nchi, nth, nph):
    k = np.arange(1, nchi + 1)
    chi = k * np.pi / (nchi + 1)
    wchi = 2.0 / (nchi + 1) * np.sin(chi) ** 2                 # (2/pi) sin^2 chi dchi
    x, wx = np.polynomial.legendre.leggauss(nth)               # cos(theta)
    wth = wx / 2.0
    ph = 2 * np.pi * (np.arange(nph) + 0.5) / nph
    wph = np.full(nph, 1.0 / nph)
    C, X, PH = np.meshgrid(chi, x, ph, indexing="ij")
    W = (wchi[:, None, None] * wth[None, :, None] * wph[None, None, :]).ravel()
    st = np.sqrt(1 - X ** 2)
    a = np.stack([np.cos(C), np.sin(C) * st * np.cos(PH), np.sin(C) * st * np.sin(PH), np.sin(C) * X], axis=-1).reshape(-1, 4)
    return a, W


def mats(a):
    m = np.empty((len(a), 2, 2), dtype=complex)
    m[:, 0, 0] = a[:, 0] + 1j * a[:, 3]
    m[:, 0, 1] = a[:, 2] + 1j * a[:, 1]
    m[:, 1, 0] = -a[:, 2] + 1j * a[:, 1]
    m[:, 1, 1] = a[:, 0] - 1j * a[:, 3]
    return m


a, W = s3_rule(12, 12, 24)
U = mats(a)
n = len(W)
phi = [U[:, 0, 0], U[:, 0, 1], U[:, 1, 0], U[:, 1, 1]]         # the four matrix elements phi_i
print(f"== 1. quadrature rule on SU(2): {n} nodes ==")
trg = np.real(U[:, 0, 0] + U[:, 1, 1])
print(f"   int 1 = {W.sum():.15f};  |int g dg| = {np.abs(np.einsum('a,aij->ij', W, U)).max():.1e};"
      f"  int Tr^2 = {np.sum(W * trg**2):.12f};  int Tr^4 = {np.sum(W * trg**4):.12f}")
half_tr = 0.5 * np.real(np.einsum("aij,bij->ab", U[:50], np.conj(U[50:120])))
print(f"   max |(1/2) Tr(u u'^dagger) - <a,a'>| = {np.abs(half_tr - a[:50] @ a[50:120].T).max():.1e}")
# orthogonality of matrix elements: int u_ab conj(u_cd) = delta_ac delta_bd / 2
G = np.array([[np.sum(W * p * np.conj(q)) for q in phi] for p in phi])
print(f"   max |int phi_i conj(phi_j) - delta_ij/2| = {np.abs(G - np.eye(4) / 2).max():.1e}")

print("== 2. (G2): conj(u11^a u12^b u21^c u22^d) = (-1)^(b+c) u22^a u21^b u12^c u11^d ==")
worst = 0.0
for al in itertools.product(range(4), repeat=4):
    lhs = np.conj(phi[0] ** al[0] * phi[1] ** al[1] * phi[2] ** al[2] * phi[3] ** al[3])
    rhs = (-1) ** (al[1] + al[2]) * phi[3] ** al[0] * phi[2] ** al[1] * phi[1] ** al[2] * phi[0] ** al[3]
    worst = max(worst, np.abs(lhs - rhs).max())
print(f"   max deviation over all exponents <= 3 and all nodes: {worst:.1e}")

print("== 3. formula (2.2), one link ==")


def multi_indices(deg):
    return [al for al in itertools.product(range(deg + 1), repeat=4) if sum(al) == deg]


def series(f, beta, nmax):
    tot, terms = 0.0, []
    pw = [np.array([p ** e for e in range(nmax + 1)]) for p in phi]       # powers of each matrix element
    for deg in range(nmax + 1):
        s = 0.0
        for al in multi_indices(deg):
            mono = pw[0][al[0]] * pw[1][al[1]] * pw[2][al[2]] * pw[3][al[3]]
            ip = np.sum(W * np.conj(mono) * f)                             # <Phi_I, f>
            s += abs(ip) ** 2 / (factorial(al[0]) * factorial(al[1]) * factorial(al[2]) * factorial(al[3]))
        terms.append((beta / 2) ** deg * s)
        tot += terms[-1]
    return tot, terms


f_poly = phi[0] ** 2 + (0.3 + 0.4j) * phi[1] + (0.5 - 0.2j) * phi[2] * phi[3] * phi[0] - 0.7j
f_smooth = np.exp(0.6 * np.real(phi[0])) * (1 + 1j * np.imag(phi[1])) + 0.2 * np.conj(phi[2]) ** 2
dots = a @ a.T
for beta in (0.5, 1.0, 2.0):
    Kmat = np.exp(beta * dots)                                             # k(u u'^-1) = exp((beta/2) Tr(u u'^dagger))
    for name, f in (("polynomial f (degree 3)", f_poly), ("smooth non-polynomial f", f_smooth)):
        lhs = np.einsum("a,ab,b->", W * np.conj(f), Kmat, W * f)
        rhs, terms = series(f, beta, 18)
        print(f"   beta={beta}, {name}: <f,Kf> = {lhs.real:.13f} (Im {lhs.imag:.1e});  series (n <= 18) = {rhs:.13f};"
              f"  diff = {abs(lhs - rhs):.1e};  first terms n=0..4: " + ", ".join(f"{t:.3e}" for t in terms[:5]))

print("== 4. spectrum of the one-link operator K ==")
for beta in (0.5, 2.0):
    Kmat = np.exp(beta * dots)
    S = np.sqrt(W)[:, None] * Kmat * np.sqrt(W)[None, :]
    ev = np.sort(np.linalg.eigvalsh(S))[::-1]
    pos = 0
    rows = []
    for nn in range(1, 8):
        block = ev[pos:pos + nn * nn]
        pos += nn * nn
        exact = 2.0 / beta * iv(nn, beta)
        rows.append(f"n={nn}: {exact:.3e} x{nn*nn} (max rel.dev {np.abs(block / exact - 1).max():.1e})")
    print(f"   beta={beta}: " + "; ".join(rows))
    hs_quad = np.einsum("a,ab,b->", W, Kmat ** 2, W)
    nn = np.arange(1, 60)
    hs_series = np.sum(nn ** 2 * (2.0 / beta * iv(nn, beta)) ** 2)
    print(f"      smallest Nystrom eigenvalue / largest = {ev[-1]/ev[0]:+.2e} (no negative part beyond rounding);"
          f"  Hilbert-Schmidt: int int K^2 = {hs_quad:.12f}, sum n^2 lambda_n^2 = {hs_series:.12f}, I_1(2 beta)/beta = {iv(1, 2*beta)/beta:.12f}")
    # (I_n(beta) > 0 for beta > 0 is evident from the power series in S6: all terms are positive.)
