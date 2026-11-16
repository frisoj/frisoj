#!/usr/bin/env python3
"""Referee C2 -- BEWIJZEN.md sections 4.6 and 5.3: the true one-link dependency coefficient of SU(2).

The conditional density of one link V in SU(2) = S^3 (unit quaternions v in R^4), given all other
links, is proportional to exp((beta/2) Tr(V S)) = exp(beta * b.v), where S is the sum of the
2(D-1) staples and b is the conjugate of S as a quaternion (|b| <= 2(D-1)).  Changing one
neighbouring link k (n_{lk} = 1) replaces one staple s (a unit quaternion) by another unit
quaternion s':  b = c + s  ->  b' = c + s',  c = sum of the other 2(D-1)-1 staples
(|c| = 1 for D = 2; any |c| in [0, 2D-3] for D >= 3).  Hence

    c_{lk}(beta, D) = sup_{c,s,s'}  d_TV( vMF(beta (c+s)), vMF(beta (c+s')) ),

with vMF(kappa) the density exp(kappa.v)/Z(|kappa|) on S^3, Z(k) = 2 I_1(k)/k.

Exact reduction used here (checked against Monte Carlo below): the projection of the uniform
measure of S^3 on a 2-plane is the uniform measure on the unit disc, and log(p_1/p_2) is linear,
so  d_TV = P_1(H) - P_2(H)  for a half-plane H, a one-dimensional integral.

Printed:
  * c_{lk}(beta, D) for D = 2, 3, 4 against Lemma C.5's bound tanh(beta), small and large beta
    (section 5.3: "nadert 1"; sum over the 6(D-1) neighbours "nadert 6(D-1)");
  * the small-beta slope 4/(3 pi) = 0.4244;
  * 6(D-1) c_{lk}(beta_0(D), D): is the true Dobrushin sum < 1 at beta_0(D)?
    (section 4.1: "de werkelijke kloof gaat niet naar nul bij beta_0(D)");
  * the beta at which the true Dobrushin sum reaches 1.

Run:  python3 review/proofs/ref_c2_su2_dobrushin.py      (from yang-mills/; about 40 s)
"""
import math

import numpy as np
from scipy.optimize import brentq, minimize
from scipy.special import ive

_X, _W = np.polynomial.legendre.leggauss(48)
NPANEL = 24


def logZ(k):
    """log of Z(k) = int_{S^3} exp(k v_1) dv = 2 I_1(k)/k  (normalised Haar measure)."""
    if k < 1e-8:
        return 0.0
    return math.log(2.0 * ive(1, k) / k) + k


def half_mass(kpar, kperp, lz, s0):
    """P(s > s0) for the density exp(kpar*s + kperp*t - lz) w.r.t. the uniform measure on the unit
    disc (coordinates (s,t)).  Substitution s = cos(th) removes the square-root endpoint behaviour;
    composite Gauss-Legendre in th on [0, arccos(s0)]."""
    if s0 >= 1.0:
        return 0.0
    thmax = math.acos(max(s0, -1.0))
    edges = np.linspace(0.0, thmax, NPANEL + 1)
    half = 0.5 * (edges[1:] - edges[:-1])[:, None]
    mid = 0.5 * (edges[1:] + edges[:-1])[:, None]
    th = (mid + half * _X[None, :]).ravel()
    w = (half * _W[None, :]).ravel()
    s, h = np.cos(th), np.sin(th)
    a = abs(kperp)
    if a < 1e-12:
        inner = 2 * h
        ex = kpar * s - lz
    else:
        # int_{-h}^{h} exp(a t) dt = (e^{a h} - e^{-a h})/a ; the factor e^{a h} is moved into the exponent
        inner = -np.expm1(-2 * a * h) / a
        ex = kpar * s + a * h - lz
    return float(np.sum(w * h * inner * np.exp(ex)) / math.pi)


def tv(k1, k2):
    """total variation distance between vMF(k1) and vMF(k2) on S^3 (k1, k2 in R^4)."""
    k1, k2 = np.asarray(k1, float), np.asarray(k2, float)
    d = k1 - k2
    nd = float(np.linalg.norm(d))
    if nd < 1e-13:
        return 0.0
    e = d / nd
    n1, n2 = float(np.linalg.norm(k1)), float(np.linalg.norm(k2))
    lz1, lz2 = logZ(n1), logZ(n2)
    s0 = (lz1 - lz2) / nd                      # p1 > p2  <=>  e.x > s0
    out = 0.0
    for k, lz, sgn in ((k1, lz1, 1.0), (k2, lz2, -1.0)):
        kpar = float(k @ e)
        kperp = math.sqrt(max(float(k @ k) - kpar * kpar, 0.0))
        out += sgn * half_mass(kpar, kperp, lz, s0)
    return out


def config(params, cnorm):
    a, a2, g = params
    c = np.array([cnorm, 0.0, 0.0, 0.0])
    s = np.array([math.cos(a), math.sin(a), 0.0, 0.0])
    s2 = np.array([math.cos(a2), math.sin(a2) * math.cos(g), math.sin(a2) * math.sin(g), 0.0])
    return c + s, c + s2


def sup_tv(beta, D, seed=0):
    """sup over the staple configuration; returns (sup, maximiser)."""
    best = (-1.0, None)
    cmax = 2 * D - 3
    rng = np.random.default_rng(seed)
    if D == 2:
        def obj(p):
            b, b2 = config(p[:3], 1.0)
            return -tv(beta * b, beta * b2)
        starts = [np.array([math.pi / 2, math.pi / 2, math.pi]), np.array([2.0, 2.0, math.pi]),
                  np.array([math.pi / 3, 2 * math.pi / 3, 0.0]), np.array([2.5, 2.5, 3.0])]
        starts += [rng.uniform(0, math.pi, size=3) for _ in range(4)]
    else:
        def obj(p):
            cn = cmax * 0.5 * (1 + math.sin(p[3]))          # keeps 0 <= |c| <= 2D-3
            b, b2 = config(p[:3], cn)
            return -tv(beta * b, beta * b2)
        starts = [np.array([math.pi / 2, math.pi / 2, math.pi, -math.pi / 2]),
                  np.array([math.pi / 2, math.pi / 2, math.pi, 0.0]),
                  np.array([2.0, 2.0, math.pi, -1.0]), np.array([0.0, math.pi, 0.0, -math.pi / 2])]
        starts += [np.concatenate([rng.uniform(0, math.pi, size=3), rng.uniform(-1.5, 1.5, size=1)]) for _ in range(4)]
    for x0 in starts:
        r = minimize(obj, x0, method="Nelder-Mead", options={"xatol": 1e-7, "fatol": 1e-12, "maxiter": 3000})
        if -r.fun > best[0]:
            best = (-r.fun, r.x)
    return best


def tv_u1(k1, k2, n=20000):
    """TV between the densities exp(k.v)/Z on the circle (U(1) with weight exp(beta Re U_p))."""
    th = (np.arange(n) + 0.5) * (2 * math.pi / n)
    v = np.stack([np.cos(th), np.sin(th)], axis=1)
    e1, e2 = v @ np.asarray(k1, float), v @ np.asarray(k2, float)
    p1 = np.exp(e1 - e1.max())
    p2 = np.exp(e2 - e2.max())
    p1 /= p1.mean()
    p2 /= p2.mean()
    return 0.5 * float(np.mean(np.abs(p1 - p2)))


def sup_tv_u1(beta, cmax, seed=0):
    """U(1): b = c + s, b' = c + s' with |s| = |s'| = 1 and 0 <= |c| <= cmax (cmax = 1 fixed for D = 2)."""
    rng = np.random.default_rng(seed)

    def obj(p):
        cn = 1.0 if cmax == 1 else cmax * 0.5 * (1 + math.sin(p[2]))
        b = np.array([cn + math.cos(p[0]), math.sin(p[0])])
        b2 = np.array([cn + math.cos(p[1]), math.sin(p[1])])
        return -tv_u1(beta * b, beta * b2)

    best = -1.0
    starts = [np.array([math.pi / 2, -math.pi / 2, -1.5]), np.array([2.0, -2.0, 0.0]), np.array([0.0, math.pi, -1.5])]
    starts += [np.concatenate([rng.uniform(-math.pi, math.pi, size=2), rng.uniform(-1.5, 1.5, size=1)]) for _ in range(3)]
    for x0 in starts:
        r = minimize(obj, x0, method="Nelder-Mead", options={"xatol": 1e-7, "fatol": 1e-12, "maxiter": 2000})
        best = max(best, -r.fun)
    return best


def mc_check():
    """independent check of tv(): Monte Carlo on S^3 with uniform samples."""
    rng = np.random.default_rng(3)
    v = rng.normal(size=(1_000_000, 4))
    v /= np.linalg.norm(v, axis=1)[:, None]
    worst = 0.0
    for k1, k2 in (((0.3, 0.1, 0, 0), (0.3, -0.1, 0.05, 0)), ((2.0, 1.0, 0, 0), (0.5, -1.0, 0.7, 0)),
                   ((4.0, 0, 0, 0), (0.0, 4.0, 0, 0)), ((1.0, 1.0, 0, 0), (1.0, -1.0, 0, 0))):
        k1, k2 = np.array(k1), np.array(k2)
        p1 = np.exp(v @ k1 - logZ(np.linalg.norm(k1)))
        p2 = np.exp(v @ k2 - logZ(np.linalg.norm(k2)))
        mc = 0.5 * np.mean(np.abs(p1 - p2))
        err = 0.5 * np.std(np.abs(p1 - p2)) / math.sqrt(len(v))
        ex = tv(k1, k2)
        worst = max(worst, abs(mc - ex) / err)
        print(f"   kappa1={k1}, kappa2={k2}: quadrature {ex:.6f}, Monte Carlo {mc:.6f} +- {err:.6f}; normalisation {np.mean(p1):.4f}")
    print(f"   largest deviation = {worst:.2f} sigma")


if __name__ == "__main__":
    print("=== check of the quadrature against Monte Carlo ===")
    mc_check()

    print("\n=== true coefficient c_lk(beta, D) = sup TV, against Lemma C.5 (tanh beta) ===")
    print("   beta      D=2 sup TV   D=3 sup TV   D=4 sup TV   tanh(beta)   (4/(3pi)) beta   simple pair b=(1,1), b'=(1,-1)")
    viol = False
    for beta in (0.01, 0.0556, 0.0835, 0.1682, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0):
        vals = [sup_tv(beta, D)[0] for D in (2, 3, 4)]
        simple = tv(beta * np.array([1.0, 1.0, 0, 0]), beta * np.array([1.0, -1.0, 0, 0]))
        viol |= any(v > math.tanh(beta) + 1e-9 for v in vals)
        print(f"   {beta:7.4f}   {vals[0]:.6f}     {vals[1]:.6f}     {vals[2]:.6f}     {math.tanh(beta):.6f}     "
              f"{4/(3*math.pi)*beta:9.6f}        {simple:.6f}")
    print("   any violation of c_lk <= tanh(beta):", viol)
    print("   -> for large beta the coefficient tends to 1 (so the sum over the 6(D-1) neighbours tends to 6(D-1))")

    print("\n=== U(1) with weight exp(beta sum_p Re U_p): same check (section 5.3, 'werkt ook voor U(1)') ===")
    print("   beta      D=2 sup TV   D=4 sup TV   tanh(beta)   (2/pi) beta")
    violu = False
    for beta in (0.01, 0.0556, 0.1682, 1.0, 5.0, 20.0, 100.0):
        v2, v4 = sup_tv_u1(beta, 1), sup_tv_u1(beta, 5)
        violu |= max(v2, v4) > math.tanh(beta) + 1e-9
        print(f"   {beta:7.4f}   {v2:.6f}     {v4:.6f}     {math.tanh(beta):.6f}     {2/math.pi*beta:.6f}")
    print("   any violation of c_lk <= tanh(beta) for U(1):", violu)
    from scipy.special import ive as _ive
    for beta in (0.05, 0.168):
        gap = 3 * math.log(_ive(0, beta) / _ive(1, beta))
        print(f"   U(1), D=2, ring L=3, beta={beta}: exact gap 3 ln(I0/I1) = {gap:.4f} >= bound ln(1/(6 tanh beta)) = "
              f"{math.log(1/(6*math.tanh(beta))):.4f}")

    print("\n=== the true Dobrushin sum 6(D-1) c_lk at beta_0(D), and where it reaches 1 ===")
    for D in (2, 3, 4):
        b0 = math.atanh(1 / (6 * (D - 1)))
        c0, x = sup_tv(b0, D)
        f = lambda be: 6 * (D - 1) * sup_tv(be, D)[0] - 1
        bstar = brentq(f, b0, 2.0, xtol=1e-5)
        print(f"   D={D}: beta_0 = {b0:.6f}; c_lk(beta_0) = {c0:.6f}; 6(D-1) c_lk(beta_0) = {6*(D-1)*c0:.4f} (< 1), "
              f"i.e. ln(1/that) = {math.log(1/(6*(D-1)*c0)):.4f}; true Dobrushin sum = 1 at beta = {bstar:.4f} "
              f"(= {bstar/b0:.2f} beta_0)")
