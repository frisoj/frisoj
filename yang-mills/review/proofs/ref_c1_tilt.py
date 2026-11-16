#!/usr/bin/env python3
"""Referee C1 -- BEWIJZEN.md section 4.2: (TV1), (TV2) and Lemma C.1 (distance after tilting).

Finite spaces (exact arithmetic up to rounding):
  1. (TV1)  sup over ALL subsets S of |nu(S) - nu'(S)|  ==  (1/2) sum |q - q'|.
  2. Lemma C.1  d_TV(nu, nu') <= tanh(osc(phi)/4), nu' = tilt of nu by e^phi; random instances with
     atoms of mass zero (a = 0 or 1 for some S; sup/inf of phi taken over the whole space, also
     where nu has no mass), tiny and huge oscillation; tightest ratio; the extremal two-point case.
  3. every line of the proof separately: the monotonicity bound nu'(S) <= s^2 a/(s^2 a + 1 - a),
     the identity s^2 a + b - (s+1)^2 a b = (s a - b)^2, the bound (s^2-1)a(1-a)/(s^2 a+1-a) <= (s-1)/(s+1)
     with equality exactly at a = 1/(1+s), and (s-1)/(s+1) = tanh(osc/4).
  4. (TV2)  |nu(F) - nu'(F)| <= osc(F) d_TV; tightest ratio (1, for F an indicator).
Continuous case:
  5. nu = distribution of x = (1/2) Tr V under Haar measure on SU(2) (density (2/pi) sqrt(1-x^2)),
     phi = kappa x: d_TV by Gauss quadrature against tanh(kappa/2); and a phi whose sup and inf
     are not attained.

Run:  python3 review/proofs/ref_c1_tilt.py      (from yang-mills/; about 5 s)
"""
import numpy as np

rng = np.random.default_rng(20261115)


def subsets(n):
    return ((np.arange(1 << n)[:, None] >> np.arange(n)[None, :]) & 1).astype(float)


def tv_sup(q, q2, M):
    return np.abs(M @ (q - q2)).max()


def tilt(q, phi):
    w = q * np.exp(phi - phi.max())
    return w / w.sum()


def main():
    ok = True
    # ---------------------------------------------------------------- 1, 2, 4
    worst_tv1 = 0.0
    best_c1 = 0.0
    best_tv2 = 0.0
    viol = 0
    ntest = 0
    for n in range(2, 9):
        M = subsets(n)
        for trial in range(1500):
            q = rng.dirichlet(np.full(n, rng.choice([0.2, 1.0, 5.0])))
            if trial % 3 == 0:                       # atoms without mass: a = 0 or a = 1 occur
                dead = rng.random(n) < 0.4
                if dead.all():
                    dead[0] = False
                q = np.where(dead, 0.0, q)
                q /= q.sum()
            scale = 10.0 ** rng.uniform(-7, 1.9)     # oscillation from 1e-7 to about 80
            phi = scale * rng.standard_normal(n)
            if trial % 7 == 0:
                phi = scale * rng.integers(0, 2, n).astype(float)      # two-valued phi (extremal shape)
            q2 = tilt(q, phi)
            tv = tv_sup(q, q2, M)
            half = 0.5 * np.abs(q - q2).sum()
            worst_tv1 = max(worst_tv1, abs(tv - half))
            osc = phi.max() - phi.min()              # over the whole space, as in the lemma
            bound = np.tanh(osc / 4)
            ntest += 1
            if tv > bound * (1 + 1e-12) + 1e-15:
                viol += 1
            if bound > 0:
                best_c1 = max(best_c1, tv / bound)
            # the monotonicity line of the proof, for every S
            s2 = np.exp(osc)
            a = M @ q
            lhs = M @ q2
            rhs = s2 * a / (s2 * a + 1 - a)
            if np.any(lhs > rhs + 1e-12):
                viol += 1
            # (TV2)
            F = rng.standard_normal(n)
            if abs(q @ F - q2 @ F) > (F.max() - F.min()) * tv + 1e-13:      # absolute test, all instances
                viol += 1
            if tv > 1e-6:                                                    # ratio only where rounding is harmless
                r = abs(q @ F - q2 @ F) / ((F.max() - F.min()) * tv)
                best_tv2 = max(best_tv2, r)
                Find = (q > q2).astype(float)
                if Find.max() > Find.min():
                    best_tv2 = max(best_tv2, abs(q @ Find - q2 @ Find) / tv)
    print("1. (TV1) sup_S vs half L1: max |difference| = %.2e over %d instances" % (worst_tv1, ntest))
    print("2. Lemma C.1 (+ monotonicity line, + (TV2) absolute test): violations %d / %d; tightest ratio d_TV / tanh(osc/4) = %.6f" % (viol, ntest, best_c1))
    print("4. (TV2): tightest ratio |nu(F)-nu'(F)| / (osc(F) d_TV) = %.6f (must be <= 1)" % best_tv2)
    ok &= worst_tv1 < 1e-12 and viol == 0 and best_c1 <= 1 + 1e-12 and best_tv2 <= 1 + 1e-9

    # extremal two-point example: equality in Lemma C.1
    print("   extremal case nu = (1/(1+s), s/(1+s)), phi = (osc, 0):")
    for osc in [1e-6, 0.2, 1.0, 4.0, 20.0, 60.0]:
        s = np.exp(osc / 2)
        q = np.array([1 / (1 + s), s / (1 + s)])
        q2 = tilt(q, np.array([osc, 0.0]))
        tv = 0.5 * np.abs(q - q2).sum()
        print("     osc %-8g d_TV %.12f  tanh(osc/4) %.12f  ratio %.12f" % (osc, tv, np.tanh(osc / 4), tv / np.tanh(osc / 4)))
        ok &= abs(tv / np.tanh(osc / 4) - 1) < 1e-9
    # edge cases
    q = np.array([0.0, 1.0, 0.0])
    q2 = tilt(q, np.array([5.0, -3.0, 9.0]))
    print("   point mass (a in {0,1} for every S): d_TV = %.3g" % (0.5 * np.abs(q - q2).sum()))
    q = rng.dirichlet(np.ones(5))
    q2 = tilt(q, np.full(5, 3.7))
    print("   phi constant (s = 1): d_TV = %.3g" % (0.5 * np.abs(q - q2).sum()))

    # ---------------------------------------------------------------- 3
    s = np.exp(np.linspace(1e-9, 30, 400))[:, None]
    a = np.linspace(0, 1, 2001)[None, :]
    b = 1 - a
    ident = np.abs(s ** 2 * a + b - (s + 1) ** 2 * a * b - (s * a - b) ** 2) / (1 + s ** 2)
    g = (s ** 2 - 1) * a * b / (s ** 2 * a + b)
    cap = (s - 1) / (s + 1)
    print("3. identity s^2 a + b - (s+1)^2 ab = (sa-b)^2: max relative residual %.2e" % ident.max())
    print("   max over (s,a) grid of [ (s^2-1)a(1-a)/(s^2 a+1-a) - (s-1)/(s+1) ] = %.3e (must be <= 0)" % (g - cap).max())
    aopt = 1 / (1 + s)
    gopt = (s ** 2 - 1) * aopt * (1 - aopt) / (s ** 2 * aopt + 1 - aopt)
    print("   at a = 1/(1+s): max |g - (s-1)/(s+1)| = %.2e (the bound is attained)" % np.abs(gopt - cap).max())
    x = np.linspace(0, 100, 1001)
    sx = np.exp(x / 2)
    print("   (s-1)/(s+1) vs tanh(osc/4): max |difference| = %.2e" % np.abs((sx - 1) / (sx + 1) - np.tanh(x / 4)).max())
    ok &= ident.max() < 1e-12 and (g - cap).max() < 1e-12

    # ---------------------------------------------------------------- 5
    xg, wg = np.polynomial.legendre.leggauss(400)
    dens = (2 / np.pi) * np.sqrt(1 - xg ** 2)
    print("5. SU(2): nu = law of x = Tr(V)/2 under Haar, phi = kappa x (osc = 2 kappa):")
    for kappa in [0.01, 0.1, 0.5, 2.0, 8.0]:
        q2 = dens * np.exp(kappa * xg)
        q2 /= (wg * q2).sum()
        tv = 0.5 * (wg * np.abs(dens - q2)).sum()
        print("     kappa %-5g d_TV %.6f   tanh(kappa/2) %.6f   ratio %.4f" % (kappa, tv, np.tanh(kappa / 2), tv / np.tanh(kappa / 2)))
        ok &= tv <= np.tanh(kappa / 2)
    # sup and inf not attained: phi(x) = c*x on the open interval (-1,1) under the same law, plus a
    # two-valued phi on a set of nu-measure 1/(1+s): equality also in the continuous setting
    for osc in [0.5, 3.0]:
        s_ = np.exp(osc / 2)
        # choose threshold t with nu(x > t) = 1/(1+s)
        ts = np.linspace(-1, 1, 200001)
        cdf_tail = 0.5 - (ts * np.sqrt(1 - ts ** 2) + np.arcsin(ts)) / np.pi
        t = ts[np.argmin(np.abs(cdf_tail - 1 / (1 + s_)))]
        a = 0.5 - (t * np.sqrt(1 - t ** 2) + np.arcsin(t)) / np.pi
        tv = s_ ** 2 * a / (s_ ** 2 * a + 1 - a) - a
        print("     two-valued phi on {x > t}, nu = %.6f = 1/(1+s): d_TV %.8f  tanh(osc/4) %.8f" % (a, tv, np.tanh(osc / 4)))
    print("ALL CHECKS PASSED" if ok else "SOME CHECK FAILED")


if __name__ == "__main__":
    main()
