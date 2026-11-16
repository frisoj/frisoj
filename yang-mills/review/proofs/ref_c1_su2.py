#!/usr/bin/env python3
"""Referee C1 -- BEWIJZEN.md sections 1.3, 4.3: Lemma C.5 for the real group SU(2).

Part 1  Tilt representation, on periodic lattices 3x3, 3x3x3, 3x4x3x3 with Haar-random links
        (own implementation with complex 2x2 matrices, plaquettes exactly as in section 1.2):
          log w((U')^{l->V}) - log w(U^{l->V}) = phi(V) + const   (const independent of V)
        with phi(V) = (beta/2) sum_{p contains l and k} [Tr (U')^{l->V}_p - Tr U^{l->V}_p];
        |phi| <= 2 beta n_lk; for non-neighbours the left side does not depend on V at all.
        Also: the largest oscillation of phi that occurs (is osc(phi) = 4 beta attainable?).
Part 2  Cross-check against the simulation code (ym.lattice, even extents only): the weight of
        section 1.3, e^{-S} = e^{-beta |P|} w, and the one-link conditional density
        rho_l(V | U) proportional to exp((beta/2) Tr(V A)), A = staple sum of the heat bath.
Part 3  The EXACT coefficient c_lk for SU(2).  The one-link conditional law is
        rho_a(v) = exp(beta <v, a>) / Z on S^3 (a = staple sum as a 4-vector); changing link k
        changes exactly one staple: a = s + r, a' = s' + r, |s| = |s'| = 1, r = sum of the other
        2(D-1) - 1 staples.  d_TV(rho_a, rho_a') is a two-dimensional integral (the projection of
        the uniform measure on S^3 onto a plane is uniform on the unit disc); its supremum over
        s, s', r is c_lk.  Compared with the bound tanh(beta) of Lemma C.5.
Part 4  tanh(n x) <= n tanh(x).

Run:  python3 review/proofs/ref_c1_su2.py      (from yang-mills/; about 40 s)
"""
import os
import sys

import numpy as np
from scipy.optimize import minimize
from scipy.special import iv

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(1, os.path.normpath(os.path.join(HERE, "..", "..")))      # yang-mills/, for "import ym"
from ref_c1_lattice import build  # noqa: E402

OK = True


def check(cond, msg):
    global OK
    if not cond:
        OK = False
        print("   FAILED: " + msg)


def q2m(q):
    q = np.asarray(q, dtype=float)
    m = np.empty(q.shape[:-1] + (2, 2), dtype=complex)
    m[..., 0, 0] = q[..., 0] + 1j * q[..., 3]
    m[..., 0, 1] = q[..., 2] + 1j * q[..., 1]
    m[..., 1, 0] = -q[..., 2] + 1j * q[..., 1]
    m[..., 1, 1] = q[..., 0] - 1j * q[..., 3]
    return m


def haar(rng, n):
    q = rng.standard_normal((n, 4))
    return q2m(q / np.linalg.norm(q, axis=1, keepdims=True))


def plaq_traces(U, P):
    """Tr U_p for U_p = U_l1 U_l2 U_l3^{-1} U_l4^{-1}; U: (nl,2,2), P: (np,4) int"""
    a = U[P[:, 0]] @ U[P[:, 1]]
    b = U[P[:, 3]] @ U[P[:, 2]]                       # (U_l3^-1 U_l4^-1) = (U_l4 U_l3)^dagger
    return np.einsum("pij,pij->p", a, b.conj()).real  # Tr(a b^dagger)


def logw(U, P, beta):
    return 0.5 * beta * plaq_traces(U, P).sum()


# ------------------------------------------------------------------------------------ part 1
def part1(rng):
    print("== Part 1: tilt representation of Lemma C.5 for SU(2) ==")
    for shape in [(3, 3), (3, 3, 3), (3, 4, 3, 3)]:
        D = len(shape)
        nl, plaq = build(shape)
        P = np.array(plaq)
        beta = 0.7                                       # any beta: the identity is exact
        U = haar(rng, nl)
        check(np.abs(U @ U.conj().transpose(0, 2, 1) - np.eye(2)).max() < 1e-13 and np.abs(np.linalg.det(U) - 1).max() < 1e-13, "not SU(2)")
        tr = plaq_traces(U, P)
        check(np.all(np.abs(tr) <= 2 + 1e-13), "(G1) |Tr| <= 2")
        member = [set() for _ in range(nl)]
        for ip, p in enumerate(plaq):
            for l in p:
                member[l].add(ip)
        worst_const, worst_nonnb, max_osc, max_abs = 0.0, 0.0, 0.0, 0.0
        for trial in range(60):
            l = int(rng.integers(nl))
            nb = sorted({k for ip in member[l] for k in plaq[ip]} - {l})
            if trial % 3 == 2:
                k = int(rng.choice([x for x in range(nl) if x != l and x not in nb]))
            else:
                k = int(rng.choice(nb))
            shared = sorted(member[l] & member[k])
            Up = U.copy()
            Up[k] = haar(rng, 1)[0] if trial % 2 else -U[k]        # also the antipodal change U_k -> -U_k
            Vs = haar(rng, 24)
            Dv, phis = [], []
            for V in Vs:
                A, B = U.copy(), Up.copy()
                A[l] = V
                B[l] = V
                Dv.append(logw(B, P, beta) - logw(A, P, beta))
                phis.append(0.5 * beta * (plaq_traces(B, P[shared]) - plaq_traces(A, P[shared])).sum() if shared else 0.0)
            Dv, phis = np.array(Dv), np.array(phis)
            if shared:
                worst_const = max(worst_const, np.ptp(Dv - phis))
                max_abs = max(max_abs, np.abs(phis).max() / (2 * beta * len(shared)))
                max_osc = max(max_osc, np.ptp(phis) / (4 * beta * len(shared)))
            else:
                worst_nonnb = max(worst_nonnb, np.ptp(Dv))
        print("   %-13s D=%d: spread over V of [log w ratio - phi(V)] = %.1e (neighbours);  spread of log w ratio = %.1e (non-neighbours);"
              "  max |phi|/(2 beta n) = %.4f,  max osc(phi)/(4 beta n) over 24 random V = %.4f" % (shape, D, worst_const, worst_nonnb, max_abs, max_osc))
        check(worst_const < 1e-11 and worst_nonnb < 1e-11 and max_abs <= 1 + 1e-12, "tilt representation")
    # osc(phi) = 4 beta is attained: one shared plaquette, U_k -> -U_k, V = +- (staple)^dagger
    nl, plaq = build((3, 3))
    P = np.array(plaq)
    U = haar(rng, nl)
    l, k = plaq[0][0], plaq[0][1]
    Up = U.copy()
    Up[k] = -U[k]
    beta = 1.0
    S = U[plaq[0][1]] @ U[plaq[0][2]].conj().T @ U[plaq[0][3]].conj().T        # U_p = U_l S
    vals = []
    for V in (S.conj().T, -S.conj().T):
        A, B = U.copy(), Up.copy()
        A[l] = V
        B[l] = V
        vals.append(0.5 * beta * (plaq_traces(B, P[[0]]) - plaq_traces(A, P[[0]])).sum())
    print("   extremal choice U_k -> -U_k, V = +-S^dagger: phi = %+.6f, %+.6f  (so osc(phi) = %.6f = 4 beta: the bound of C.5 on osc(phi) is attained)"
          % (vals[0], vals[1], abs(vals[0] - vals[1])))
    check(abs(abs(vals[0] - vals[1]) - 4 * beta) < 1e-12, "osc(phi) = 4 beta attained")


# ------------------------------------------------------------------------------------ part 2
def part2(rng):
    print("== Part 2: the weight of section 1.3 and the heat-bath conditional against ym.lattice ==")
    try:
        from ym.lattice import Lattice, staple_sum
    except Exception as exc:                                  # pragma: no cover
        print("   ym not importable (%s): skipped" % exc)
        return
    for shape, beta in [((4, 4), 0.15), ((4, 4, 4), 0.08), ((4, 2, 4, 6), 2.3)]:
        lat = Lattice(shape, beta, seed=11)
        lat.hot_start()
        lat.heatbath_sweep(2)
        nl, plaq = build(shape)
        P = np.array(plaq)
        U = q2m(lat.U.reshape(nl, 4))
        lw = logw(U, P, beta)
        S = lat.action()
        err = abs((-S) - (lw - beta * len(plaq)))
        # one-link conditional: log w(U^{l->V}) - (beta/2) Tr(V A) must not depend on V
        spread = 0.0
        for trial in range(5):
            s, mu = int(rng.integers(lat.V)), int(rng.integers(lat.D))
            A = q2m(np.array(staple_sum(lat.U, lat.up, lat.dn, s, mu)))
            vals = []
            for V in haar(rng, 8):
                W = U.copy()
                W[s * lat.D + mu] = V
                vals.append(logw(W, P, beta) - 0.5 * beta * np.trace(V @ A).real)
            spread = max(spread, np.ptp(vals))
        print("   %-13s beta=%.2f  |P| = %d (ym: %d)   | -S - (log w - beta|P|) | = %.1e   spread of log w(U^{l->V}) - (beta/2)Tr(VA) = %.1e"
              % (shape, beta, len(plaq), lat.n_plaq, err, spread))
        check(len(plaq) == lat.n_plaq and err < 1e-9 and spread < 1e-10, "ym cross-check")


# ------------------------------------------------------------------------------------ part 3
class Disc:
    """uniform probability measure on the unit disc (= projection of Haar measure on S^3 onto a plane)"""

    def __init__(self, nr, nt):
        x, w = np.polynomial.legendre.leggauss(nr)
        r = 0.5 * (x + 1)
        wr = 0.5 * w * 2 * r                                  # 2 r dr on [0,1]
        t = 2 * np.pi * (np.arange(nt) + 0.5) / nt
        self.x = (r[:, None] * np.cos(t)[None, :]).ravel()
        self.y = (r[:, None] * np.sin(t)[None, :]).ravel()
        self.w = (wr[:, None] * np.full(nt, 1.0 / nt)[None, :]).ravel()


def Zfun(kappa):
    """int_{S^3} exp(kappa x) dv = 2 I_1(kappa)/kappa"""
    return 1.0 if kappa < 1e-12 else 2 * iv(1, kappa) / kappa


def tv_vmf(disc, beta, a, ap):
    """d_TV between densities exp(beta<v,a>)/Z and exp(beta<v,a'>)/Z on S^3; a, a' vectors (any dimension)"""
    na, nap = np.linalg.norm(a), np.linalg.norm(ap)
    # orthonormal frame of span(a, a')
    if na < 1e-14 and nap < 1e-14:
        return 0.0
    e1 = a / na if na >= 1e-14 else ap / nap
    rest = ap - (ap @ e1) * e1
    nr = np.linalg.norm(rest)
    c1, c2 = ap @ e1, nr
    f = np.exp(beta * na * disc.x) / Zfun(beta * na)
    g = np.exp(beta * (c1 * disc.x + c2 * disc.y)) / Zfun(beta * nap)
    return 0.5 * (disc.w * np.abs(f - g)).sum()


def part3(rng):
    print("== Part 3: exact Dobrushin coefficient c_lk of SU(2) against the bound tanh(beta) of Lemma C.5 ==")
    coarse, fine = Disc(40, 80), Disc(300, 600)
    # sanity of the disc rule: normalisation of the vMF density and the semicircle moments
    for kappa in (0.3, 2.0):
        check(abs((fine.w * np.exp(kappa * fine.x)).sum() - Zfun(kappa)) < 1e-10, "disc rule / Z")
    check(abs((fine.w * fine.x ** 2).sum() - 0.25) < 1e-12, "disc rule: E x^2 = 1/4")
    xg, wg = np.polynomial.legendre.leggauss(2000)
    semi = (2 / np.pi) * np.sqrt(1 - xg ** 2) * wg

    def params_to_vectors(prm, m):
        rho = 1.0 if m == 1 else m / (1 + np.exp(-prm[0]))          # |r| = 1 (D = 2) or 0 <= |r| <= m
        t1, t2, ph = prm[1], prm[2], prm[3]
        r = np.array([rho, 0, 0])
        s = np.array([np.cos(t1), np.sin(t1), 0])
        sp = np.array([np.cos(t2), np.sin(t2) * np.cos(ph), np.sin(t2) * np.sin(ph)])
        return s + r, sp + r, rho

    print("   %-3s %-7s %-10s %-12s %-12s %-10s %s" % ("D", "beta", "tanh(beta)", "sup d_TV", "ratio", "|r| at sup", "antipodal r=0 (exact)"))
    for D in (2, 3, 4):
        m = 2 * (D - 1) - 1
        b0 = np.arctanh(1 / (6 * (D - 1)))
        for beta in (0.25 * b0, b0, 0.5, 2.0):
            best, bprm = 0.0, None
            for start in range(14):
                prm0 = np.array([rng.normal(-2, 2), rng.uniform(0, np.pi), rng.uniform(0, np.pi), rng.uniform(0, np.pi)])
                if start == 0:
                    prm0 = np.array([-8.0, 0.0, np.pi, 0.0])            # r ~ 0, s' = -s
                if start == 1:
                    prm0 = np.array([-8.0, np.pi / 2, np.pi / 2, np.pi])  # s, s' perpendicular to r, antipodal
                fun = lambda prm: -tv_vmf(coarse, beta, *params_to_vectors(prm, m)[:2])
                res = minimize(fun, prm0, method="Nelder-Mead", options=dict(xatol=1e-4, fatol=1e-9, maxiter=400))
                if -res.fun > best:
                    best, bprm = -res.fun, res.x
            a, ap, rho = params_to_vectors(bprm, m)
            sup = tv_vmf(fine, beta, a, ap)
            # the antipodal case r = 0, s' = -s in closed form: E|sinh(beta x)| / E cosh(beta x), x ~ semicircle
            anti = (semi * np.abs(np.sinh(beta * xg))).sum() / (semi * np.cosh(beta * xg)).sum()
            anti_note = "%.6f" % anti if m > 1 else "%.6f (not allowed: |r|=1)" % anti
            print("   %-3d %-7.4f %-10.6f %-12.6f %-12.4f %-10.3f %s" % (D, beta, np.tanh(beta), sup, sup / np.tanh(beta), rho, anti_note))
            check(sup <= np.tanh(beta) * (1 + 1e-6), "c_lk <= tanh(beta) violated for SU(2)")
    print("   (for beta -> 0 the antipodal value is beta E|x| = 4 beta/(3 pi) = 0.4244 beta: Lemma C.5 is a true upper bound,")
    print("    not sharp for SU(2); for the centre Z2 the ratio is 1/(1 + tanh^2 beta), i.e. sharp to first order)")


def part4():
    x = np.linspace(0, 20, 20001)
    worst = max(np.max(np.tanh(n * x) - n * np.tanh(x)) for n in range(0, 8))
    print("== Part 4: max over x in [0,20], n = 0..7 of tanh(n x) - n tanh(x) = %.2e (must be <= 0) ==" % worst)
    check(worst <= 1e-15, "subadditivity of tanh")


def main():
    rng = np.random.default_rng(20261115)
    part1(rng)
    part2(rng)
    part3(rng)
    part4()
    print("ALL CHECKS PASSED" if OK else "SOME CHECK FAILED")
    return 0 if OK else 1


if __name__ == "__main__":
    sys.exit(main())
