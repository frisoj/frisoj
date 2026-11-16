#!/usr/bin/env python3
"""Referee C2 -- BEWIJZEN.md Stelling C, point 2, in the Z2 laboratory.

G = Z2 = {+1,-1}, Haar = normalised counting measure, weight exp(beta * sum_p sigma_p)
(the SU(2) weight (beta/2) Tr U_p restricted to the centre).  The proof of Stelling C uses only
|Tr| <= 2, so  m >= ln(1/(6(D-1) tanh beta))  must hold here with the same constants.

Transfer matrix (section 2.2):  T = M K P M,  M = exp((beta/2) sum_{p spatial} sigma_p),
K(u,u') = prod_e exp(beta u_e u'_e),  P = average over gauge transformations.

Part 1  D = 2, rings L = 3, 4, 5: T built literally on the 2^L configurations.
Part 2  D = 3, spatial torus 3 x 3 (18 links, 2^18 configurations), three independent methods:
        (a) Lanczos (scipy eigsh) on the full space, T applied through the tensor-product
            structure of K and site-by-site gauge averaging;
        (b) dense 1024 x 1024 matrix of T on H_inv in the basis of gauge-invariant characters
            chi_S, S a closed loop configuration (cycle), where K is diagonal and M is a
            product of shifts by plaquette boundaries;
        (c) the same in "dual" tensor form (cycle = winding sector + sum of plaquette
            boundaries), which also reaches larger spatial tori (3x4, 3x5, 4x4, 4x5).
        Also: the finite-t inequality used in the proof of point 2 with F = psi_1/Omega.
Part 3  the covariance inequality of the proof of point 2 at finite N on 3 x 3 x N (D = 3).

Run:  python3 review/proofs/ref_c2_z2_gap.py      (from yang-mills/; about 60 s)
"""
import itertools
import math

import numpy as np
from scipy.sparse.linalg import LinearOperator, eigsh

from ref_c2_geometry import Torus

np.set_printoptions(linewidth=160, precision=6)


def bound(beta, D):
    a = 6 * (D - 1) * math.tanh(beta)
    return math.log(1 / a) if a < 1 else float("nan")


# ------------------------------------------------------------------------------------ part 1
def ring(L, beta):
    C = np.array(list(itertools.product((1, -1), repeat=L)), dtype=float)
    nC = len(C)
    index = {tuple(c): a for a, c in enumerate(C)}
    P = np.zeros((nC, nC))
    for g in C:
        ug = g[None, :] * C * np.roll(g, -1)[None, :]            # (u^g)_i = g_i u_i g_{i+1}
        for a in range(nC):
            P[a, index[tuple(ug[a])]] += 1.0 / nC
    K = np.exp(beta * (C @ C.T)) / nC
    T = K @ P                                                    # no spatial plaquettes: M = 1
    lam = np.sort(np.linalg.eigvalsh((T + T.T) / 2))[::-1]
    return lam, np.abs(T - T.T).max()


def part1():
    print("=== Part 1: Z2, D = 2, rings ===")
    print("  L  beta    lambda_0        lambda_1        #ev>1e-13  gap m       L ln coth(beta)  bound ln(1/(6 tanh))  m >= bound")
    ok = True
    for L in (3, 4, 5):
        for beta in (0.02, 0.05, 0.10, 0.15, 0.168):
            lam, asym = ring(L, beta)
            m = math.log(lam[0] / lam[1])
            b = bound(beta, 2)
            ok &= (m >= b) and asym < 1e-14
            print(f"  {L}  {beta:5.3f}  {lam[0]:.10f}  {lam[1]:.6e}  {int((lam > 1e-13).sum()):3d}       {m:9.5f}  "
                  f"{L*math.log(1/math.tanh(beta)):9.5f}        {b:8.5f}             {m >= b}")
    print("  all rings satisfy the bound:", ok)


# ------------------------------------------------------------------------------------ part 2
class Slice:
    """Z2 spatial slice: functions on Z2^E as arrays of shape (2,)*nl (index 0 <-> +1, 1 <-> -1)."""

    def __init__(self, sshape, beta):
        self.T = lat = Torus(sshape)
        self.nl = nl = lat.nl
        self.beta = beta
        self.shape = (2,) * nl
        sign = []
        for e in range(nl):
            sh = [1] * nl
            sh[e] = 2
            sign.append(np.array([1.0, -1.0]).reshape(sh))
        S = np.zeros(self.shape)
        for p in lat.plaq:
            S = S + sign[p[0]] * sign[p[1]] * sign[p[2]] * sign[p[3]]
        self.plaqsum = S
        self.Mdiag = np.exp(0.5 * beta * S)
        # links touching each site: (x,mu) and (x-mu,mu)
        self.star = []
        for x in lat.sites:
            st = []
            for mu in range(lat.D):
                st.append(lat.link(x, mu))
                st.append(lat.link(lat.shift(x, mu, -1), mu))
            self.star.append(tuple(sorted(set(st))))
        self.sign = sign

    def applyK(self, v):
        a, b = 0.5 * math.exp(self.beta), 0.5 * math.exp(-self.beta)
        for e in range(self.nl):
            v = a * v + b * np.flip(v, axis=e)
        return v

    def applyP(self, v):
        for st in self.star:
            v = 0.5 * (v + np.flip(v, axis=st))
        return v

    def applyT(self, vec):
        v = vec.reshape(self.shape) * self.Mdiag
        v = self.applyP(v)
        v = self.applyK(v)
        v = v * self.Mdiag
        return v.reshape(-1)


def method_a(sl, k=6):
    n = 2 ** sl.nl
    op = LinearOperator((n, n), matvec=sl.applyT, dtype=float)
    v0 = np.random.default_rng(1).normal(size=n)
    lam, vec = eigsh(op, k=k, which="LA", v0=v0, tol=1e-13)
    order = np.argsort(lam)[::-1]
    return lam[order], vec[:, order]


def cycles(lat):
    """all subsets S of links (bitmask) with even degree at every site."""
    nl = lat.nl
    codes = np.arange(2 ** nl, dtype=np.int64)
    okmask = np.ones(len(codes), dtype=bool)
    for x in lat.sites:
        par = np.zeros(len(codes), dtype=np.int64)
        for mu in range(lat.D):
            par ^= (codes >> lat.link(x, mu)) & 1
            par ^= (codes >> lat.link(lat.shift(x, mu, -1), mu)) & 1
        okmask &= (par == 0)
    return codes[okmask]


def method_b(lat, beta, full=False):
    cyc = cycles(lat)
    idx = {int(c): i for i, c in enumerate(cyc)}
    n = len(cyc)
    size = np.array([bin(int(c)).count("1") for c in cyc])
    M = np.eye(n)
    c, s = math.cosh(beta / 2), math.sinh(beta / 2)
    for p in lat.plaq:
        mask = 0
        for l in p:
            mask ^= (1 << l)
        perm = np.array([idx[int(cc) ^ mask] for cc in cyc])
        X = np.zeros((n, n))
        X[np.arange(n), perm] = 1.0
        M = (c * np.eye(n) + s * X) @ M
    Kd = np.cosh(beta) ** (lat.nl - size) * np.sinh(beta) ** size
    Tm = M @ np.diag(Kd) @ M.T
    Tm = (Tm + Tm.T) / 2
    lam = np.sort(np.linalg.eigvalsh(Tm))[::-1]
    if full:
        return lam, n, Tm, cyc, idx
    return lam, n, float(np.abs(M - M.T).max())


def method_c(sshape, beta, k=3):
    """dual tensor form; returns dict sector -> top eigenvalues of T / cosh(beta)^nl."""
    lat = Torus(sshape)
    L1, L2 = sshape
    nP = len(lat.plaq)
    shape = (2,) * nP
    tb = math.tanh(beta)
    c, s = math.cosh(beta / 2), math.sinh(beta / 2)
    out = {}
    bitarr = []
    for p in range(nP):
        sh = [1] * nP
        sh[p] = 2
        bitarr.append(np.array([0, 1], dtype=np.int8).reshape(sh))
    for b1 in (0, 1):
        for b2 in (0, 1):
            s0 = np.zeros(lat.nl, dtype=np.int8)
            if b1:
                for i in range(L1):
                    s0[lat.link((i, 0), 0)] ^= 1
            if b2:
                for j in range(L2):
                    s0[lat.link((0, j), 1)] ^= 1
            size = np.zeros(shape, dtype=np.int16)
            for e in range(lat.nl):
                p1, p2 = lat.through[e]
                size = size + (bitarr[p1] ^ bitarr[p2] ^ s0[e])
            Kd = tb ** size.astype(float)
            allax = tuple(range(nP))

            def applyT(vec, Kd=Kd):
                v = vec.reshape(shape)
                v = 0.5 * (v + np.flip(v, axis=allax))          # identification a ~ a + (1,...,1)
                for p in range(nP):
                    v = c * v + s * np.flip(v, axis=p)
                v = v * Kd
                for p in range(nP):
                    v = c * v + s * np.flip(v, axis=p)
                v = 0.5 * (v + np.flip(v, axis=allax))
                return v.reshape(-1)

            n = 2 ** nP
            op = LinearOperator((n, n), matvec=applyT, dtype=float)
            v0 = np.random.default_rng(7 + 2 * b1 + b2).normal(size=n)
            lam = eigsh(op, k=k, which="LA", v0=v0, tol=1e-13, return_eigenvectors=False)
            out[(b1, b2)] = np.sort(lam)[::-1]
    return out, lat.nl


def gap_from_sectors(sec):
    lam0 = sec[(0, 0)][0]
    cand = [sec[(0, 0)][1]] + [sec[k][0] for k in sec if k != (0, 0)]
    lam1 = max(cand)
    which = "trivial sector (glueball-like)" if lam1 == sec[(0, 0)][1] else "winding sector (torelon-like)"
    return math.log(lam0 / lam1), lam0, lam1, which


def part2():
    print("\n=== Part 2: Z2, D = 3, spatial torus 3 x 3 ===")
    lat = Torus((3, 3))
    print("  beta    method   lambda_0            lambda_1            lambda_2            gap m      3 ln coth  4 ln coth  bound      m>=bound")
    ok = True
    for beta in (0.02, 0.05, 0.08, 0.0835):
        sl = Slice((3, 3), beta)
        la, va = method_a(sl)
        lb, n, _ = method_b(lat, beta)
        sec, nl = method_c((3, 3), beta)
        lc = np.sort(np.concatenate([v for v in sec.values()]))[::-1] * math.cosh(beta) ** nl
        b = bound(beta, 3)
        for name, lam in (("(a) Lanczos 2^18", la), (f"(b) dense {n}", lb), ("(c) dual tensor", lc)):
            m = math.log(lam[0] / lam[1])
            ok &= (m >= b)
            print(f"  {beta:6.4f}  {name:17s} {lam[0]:.12f}  {lam[1]:.10e}  {lam[2]:.10e}  {m:9.5f}  "
                  f"{3*math.log(1/math.tanh(beta)):8.4f}  {4*math.log(1/math.tanh(beta)):8.4f}  {b:8.5f}  {m >= b}")
        agree = max(abs(la[i] / lb[i] - 1) for i in range(3)), max(abs(lc[i] / lb[i] - 1) for i in range(3))
        print(f"          relative agreement of the three methods on lambda_0..2: (a)/(b) {agree[0]:.1e}, (c)/(b) {agree[1]:.1e};"
              f"  dim H_inv = {n}; degeneracy of lambda_1 (b): {int((abs(lb/lb[1]-1) < 1e-9).sum())}")
        # finite-t inequality of the proof of point 2, with F = psi_1 / Omega (from method (a))
        Om = va[:, 0] * np.sign(va[:, 0].sum())
        psi1 = va[:, 1]
        F = (psi1 / Om).reshape(sl.shape)
        osc = F.max() - F.min()
        Delta = sum(np.abs(F - np.flip(F, axis=e)).max() for e in range(sl.nl))
        norm = float(psi1 @ psi1) / float(Om @ Om)      # <psi_1,F Omega>^2 with ||Omega|| = 1 and ||psi_1|| = 1
        alpha = 12 * math.tanh(beta)
        worst = -1e99
        for theta_frac in (0.1, 0.5, 0.9, 0.99):
            theta = theta_frac * math.log(1 / alpha)
            Cth = math.exp(theta) / (1 - alpha * math.exp(theta))
            for t in range(1, 40):
                lhs = (la[1] / la[0]) ** t
                rhs = Cth * 0.5 * osc * Delta * math.exp(-theta * t)
                worst = max(worst, lhs / rhs)
        print(f"          F = psi_1/Omega: min Omega/max Omega = {Om.min()/Om.max():.4f} (>0), osc(F) = {osc:.4f}, Delta(F) = {Delta:.4f};"
              f" max over t<40, theta of (lambda_1/lambda_0)^t / [C_theta osc(F)/2 Delta(F) e^(-theta t)] = {worst:.3e} (must be <= 1)")
        ok &= worst <= 1
    print("  all 3x3 results satisfy the bound:", ok)

    print("\n  beyond beta_0(3) = 0.0835 (no statement by Stelling C; the Z2 gap on 3 x 3 stays large):")
    for beta in (0.1, 0.2, 0.4):
        lb, n, _ = method_b(lat, beta)
        print(f"    beta = {beta}: gap m = {math.log(lb[0]/lb[1]):.5f}")

    print("\n=== Part 2c: Z2, D = 3, larger spatial tori (dual tensor form), volume dependence ===")
    print("  spatial  beta    gap m      lowest excitation               Lmin*ln coth  4 ln coth  bound      m>=bound")
    ok = True
    for sshape, betas in (((3, 3), (0.02, 0.05, 0.08)), ((3, 4), (0.02, 0.05, 0.08)), ((3, 5), (0.02, 0.05, 0.08)),
                          ((4, 4), (0.02, 0.05, 0.08)), ((4, 5), (0.05,))):
        for beta in betas:
            sec, nl = method_c(sshape, beta)
            m, lam0, lam1, which = gap_from_sectors(sec)
            b = bound(beta, 3)
            ok &= (m >= b)
            print(f"  {str(sshape):7s}  {beta:5.3f}  {m:9.5f}  {which:30s}  {min(sshape)*math.log(1/math.tanh(beta)):9.4f}    "
                  f"{4*math.log(1/math.tanh(beta)):8.4f}  {b:8.5f}  {m >= b}")
    print("  all larger tori satisfy the bound:", ok)


def part3():
    """The inequality displayed in the proof of point 2, at FINITE N (before the limit):
       |mu(F(u^0)F(u^t)) - mu(F(u^0)) mu(F(u^t))| <= C_theta (osc F / 2) Delta(F) e^{-theta t},  N >= max(3, 2t),
    on the 3 x 3 x N lattice (D = 3), with the left side from Stelling A point 5 (traces of T on H_inv)."""
    print("\n=== Part 3: Z2, D = 3, lattice 3 x 3 x N: connected time correlations versus the bound of point 1 ===")
    lat = Torus((3, 3))
    worst = 0.0
    for beta in (0.02, 0.05, 0.08):
        lam, n, Tm, cyc, idx = method_b(lat, beta, full=True)
        alpha = 12 * math.tanh(beta)
        la = math.log(1 / alpha)

        def shift_op(mask):
            perm = np.array([idx[int(c) ^ mask] for c in cyc])
            X = np.zeros((n, n))
            X[np.arange(n), perm] = 1.0
            return X

        pm = 0
        for l in lat.plaq[0]:
            pm ^= (1 << l)
        wm = 0
        for i in range(3):
            wm ^= (1 << lat.link((i, 0), 0))
        obs = {"F = sigma_p (osc 2, Delta 8)": (shift_op(pm), 2.0, 8.0),
               "F = spatial winding loop (osc 2, Delta 6)": (shift_op(wm), 2.0, 6.0)}
        Tn = Tm / lam[0]
        pw = {0: np.eye(n)}
        for j in range(1, 41):
            pw[j] = pw[j - 1] @ Tn
        for name, (F, oscF, DelF) in obs.items():
            rows = []
            for t in (1, 2, 3, 4):
                for N in sorted({max(3, 2 * t), 2 * t + 1, 2 * t + 3, 40}):
                    ZN = np.trace(pw[N])
                    two = np.trace(F @ pw[t] @ F @ pw[N - t]) / ZN
                    one = np.trace(F @ pw[N]) / ZN
                    cov = two - one * one
                    best = min((math.exp(fr * la) / (1 - alpha * math.exp(fr * la))) * 0.5 * oscF * DelF * math.exp(-fr * la * t)
                               for fr in (0.05, 0.2, 0.4, 0.6, 0.8, 0.95))
                    worst = max(worst, abs(cov) / best)
                    rows.append(f"t={t},N={N}: {cov:.3e}/{best:.3e}")
            print(f"  beta={beta}: {name}: cov/bound  " + "; ".join(rows[:6]) + " ...")
    print(f"  largest |cov|/bound over all beta, F, t, N = {worst:.3e}  ->  violation: {worst > 1}")


if __name__ == "__main__":
    part1()
    part2()
    part3()
