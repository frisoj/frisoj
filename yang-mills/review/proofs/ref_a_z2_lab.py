#!/usr/bin/env python3
"""Referee check of Stelling A (BEWIJZEN.md, section 2) in a Z2 laboratory.

G = Z2 = {+1,-1}, Haar measure = normalised counting measure, weight
w = exp(beta * sum_p sigma_p)  (= the SU(2) formula restricted to the centre).

Everything is built literally from the definitions of sections 1.2, 2.1, 2.2:
  * full lattice: links (x,mu), plaquettes (x;mu,nu), mu<nu, brute-force sum;
  * time-slice objects: V, k, K, M, K-operator, P, T = M K P M.
Operators act on functions on C = G^E; an integral operator with kernel
k(u,u') w.r.t. the normalised counting measure is the matrix k/|C|.

Z2 tests the ALGEBRA of the proof (decomposition (2.1), operator identities,
trace formulas, Perron-Frobenius, correlation formula), not the SU(2)-specific
steps (Stone-Weierstrass, infinite dimension of H_inv).

Run:  python3 review/proofs/ref_a_z2_lab.py     (from yang-mills/)
"""
import itertools
import numpy as np

np.set_printoptions(linewidth=140, precision=6)


class Lattice:
    """Periodic lattice with the conventions of section 1.2."""

    def __init__(self, shape):
        self.shape = tuple(shape)
        self.D = len(shape)
        self.sites = list(itertools.product(*[range(n) for n in shape]))
        self.sidx = {s: i for i, s in enumerate(self.sites)}
        self.links = [(s, mu) for s in self.sites for mu in range(self.D)]
        self.lidx = {l: i for i, l in enumerate(self.links)}
        self.plaq = []
        for s in self.sites:
            for mu in range(self.D):
                for nu in range(mu + 1, self.D):
                    self.plaq.append((self.lidx[(s, mu)],
                                      self.lidx[(self.shift(s, mu), nu)],
                                      self.lidx[(self.shift(s, nu), mu)],
                                      self.lidx[(s, nu)]))

    def shift(self, s, mu):
        s = list(s)
        s[mu] = (s[mu] + 1) % self.shape[mu]
        return tuple(s)


def plaquette_sum(lat, cfg):
    """sum_p sigma_p for integer-coded configurations cfg (bit=1 <-> sigma=-1)."""
    tot = np.zeros(cfg.shape, dtype=np.int32)
    for (a, b, c, d) in lat.plaq:
        par = ((cfg >> a) ^ (cfg >> b) ^ (cfg >> c) ^ (cfg >> d)) & 1
        tot += 1 - 2 * par.astype(np.int32)
    return tot


def build_slice_objects(sshape, beta):
    """M, K, P, T on H = functions on C = Z2^E for the spatial lattice sshape."""
    ls = Lattice(sshape)
    nE = len(ls.links)
    nC = 2 ** nE
    cfg = np.arange(nC, dtype=np.int64)
    # V(u) = -beta * sum_{spatial p} sigma_p   (Z2 version of -(beta/2) sum Tr u_p)
    V = -beta * plaquette_sum(ls, cfg).astype(float) if ls.plaq else np.zeros(nC)
    # K(u,u') = prod_e exp(beta * u_e u'_e)
    x = cfg[:, None] ^ cfg[None, :]
    pop = np.zeros_like(x)
    for e in range(nE):
        pop += (x >> e) & 1
    Kker = np.exp(beta * (nE - 2 * pop))
    # gauge transformations (u^g)_(x,i) = g_x u_(x,i) g_{x+i}^{-1}
    nS = len(ls.sites)
    gauge_masks = []
    for g in range(2 ** nS):
        mask = 0
        for (s, i), e in ls.lidx.items():
            gx = (g >> ls.sidx[s]) & 1
            gy = (g >> ls.sidx[ls.shift(s, i)]) & 1
            mask |= (gx ^ gy) << e
        gauge_masks.append(mask)
    P = np.zeros((nC, nC))
    for mask in gauge_masks:
        P[cfg, cfg ^ mask] += 1.0 / len(gauge_masks)
    M = np.diag(np.exp(-V / 2))
    Kop = Kker / nC
    T = M @ Kop @ P @ M
    # kernel of step 4:  T0(u,u') = int K(u^g,u') dg ;  T(u,u') = e^{-V/2} T0 e^{-V/2}
    T0 = np.zeros((nC, nC))
    for mask in gauge_masks:
        T0 += Kker[cfg ^ mask, :] / len(gauge_masks)
    Tker = np.exp(-V / 2)[:, None] * T0 * np.exp(-V / 2)[None, :]
    return dict(ls=ls, nE=nE, nC=nC, V=V, Kker=Kker, Kop=Kop, P=P, M=M, T=T, T0=T0,
                Tker=Tker, gauge_masks=gauge_masks)


def slice_index(full, ls, cfg, t):
    """integer code of the spatial configuration u^t of the full configurations cfg."""
    out = np.zeros(cfg.shape, dtype=np.int64)
    for (s, i), e in ls.lidx.items():
        l = full.lidx[(tuple(s) + (t,), i)]
        out |= ((cfg >> l) & 1) << e
    return out


def run(sshape, N, beta, seed=1, corr=True):
    rng = np.random.default_rng(seed)
    o = build_slice_objects(sshape, beta)
    P, M, Kop, T, Tker, nC = o["P"], o["M"], o["Kop"], o["T"], o["Tker"], o["nC"]
    print(f"\n=== spatial shape {sshape}, N={N}, beta={beta}: |E|={o['nE']}, |C|={nC}, "
          f"spatial plaquettes={len(o['ls'].plaq)} ===")
    err = lambda A, B: float(np.max(np.abs(A - B)))
    # step 2
    print(f" step 2(a)  P^2=P: {err(P @ P, P):.2e}   P=P^T: {err(P, P.T):.2e}   rank P = dim H_inv = {int(round(np.trace(P)))}")
    print(f" step 2(b)  MP=PM: {err(M @ P, P @ M):.2e}")
    print(f" step 2(c)  K sym: {err(Kop, Kop.T):.2e}   KP=PK: {err(Kop @ P, P @ Kop):.2e}")
    ek = np.linalg.eigvalsh(Kop)
    print(f" step 3     K eigenvalues: min {ek.min():.3e} (>0: K positive and injective)")
    # step 4
    print(f" step 4     T=MKPM vs MPKM: {err(T, M @ P @ Kop @ M):.2e}   vs P(MKM)P: {err(T, P @ M @ Kop @ M @ P):.2e}"
          f"   vs kernel/|C|: {err(T, Tker / nC):.2e}")
    print(f"            kernel sym: {err(Tker, Tker.T):.2e}   min kernel = {Tker.min():.6f}   max kernel = {Tker.max():.6f}")
    print(f"            T=PT: {err(T, P @ T):.2e}   T=TP: {err(T, T @ P):.2e}")
    # brute force Z on the full lattice (section 1.3)
    full = Lattice(tuple(sshape) + (N,))
    nl = len(full.links)
    cfg = np.arange(2 ** nl, dtype=np.int64)
    w = np.exp(beta * plaquette_sum(full, cfg))
    Zbrute = w.sum() / 2 ** nl
    TN = np.linalg.matrix_power(T, N)
    Ztr = np.trace(TN)
    print(f" step 4     Z brute force ({2**nl} configs, {len(full.plaq)} plaquettes) = {Zbrute:.12f}   Tr T^N = {Ztr:.12f}"
          f"   rel.diff {abs(Zbrute-Ztr)/Zbrute:.2e}")
    # step 5/6
    lam, vec = np.linalg.eigh(T)
    lam, vec = lam[::-1], vec[:, ::-1]
    r = int(round(np.trace(P)))
    print(f" step 5     eigenvalues>1e-12: {int(np.sum(lam > 1e-12))} (= rank P {r});  min eigenvalue of T on H: {lam.min():.2e};"
          f"  smallest on H_inv: {lam[r-1]:.3e}")
    print(f"            top eigenvalues: {lam[:4]}")
    om = vec[:, 0] * np.sqrt(nC)        # normalised in L2(counting prob. measure)
    om = om * np.sign(om[0])
    print(f" step 6     lambda_0 simple: lambda_1/lambda_0 = {lam[1]/lam[0]:.6f} < 1;  min Omega = {om.min():.6f} > 0;"
          f"  ||P Omega - Omega|| = {np.linalg.norm(P @ om - om):.1e}")
    print(f" remark     min T/max T = {Tker.min()/Tker.max():.6f};  min T/lambda_0 = {Tker.min()/lam[0]:.6f};"
          f"  Doeblin bound lambda_1/lambda_0 <= 1 - min/max = {1-Tker.min()/Tker.max():.6f}")
    if not corr:
        return o, lam, vec
    # step 8: first formula, brute force vs trace formula, complex bounded F1, F2
    F1 = rng.normal(size=nC) + 1j * rng.normal(size=nC)
    F2 = rng.normal(size=nC) + 1j * rng.normal(size=nC)
    worst = 0.0
    u0 = slice_index(full, o["ls"], cfg, 0)
    for t in range(1, N):
        ut = slice_index(full, o["ls"], cfg, t)
        brute = np.sum(w * F1[u0] * F2[ut]) / w.sum()
        tr = np.trace(np.diag(F1) @ np.linalg.matrix_power(T, t) @ np.diag(F2) @ np.linalg.matrix_power(T, N - t)) / Ztr
        worst = max(worst, abs(brute - tr))
    print(f" step 8     mu(F1(u^0)F2(u^t)) brute force vs Tr(F1 T^t F2 T^(N-t))/Tr T^N, t=1..{N-1}: max diff {worst:.2e}")
    # one-point function
    brute1 = np.sum(w * F1[u0]) / w.sum()
    print(f"            mu(F1(u^0)) vs Tr(F1 T^N)/Tr T^N: {abs(brute1 - np.trace(np.diag(F1) @ TN)/Ztr):.2e}")
    return o, lam, vec


def limit_check(o, lam, vec, beta, seed=2):
    """N -> infinity: connected correlation vs C_F(t); bounds of point 5."""
    rng = np.random.default_rng(seed)
    T, nC, P = o["T"], o["nC"], o["P"]
    r = int(round(np.trace(P)))
    psi = vec[:, :r] * np.sqrt(nC)
    psi[:, 0] *= np.sign(psi[0, 0])
    Om = psi[:, 0]
    ip = lambda a, b: np.vdot(a, b) / nC
    F = rng.normal(size=nC)                      # real, NOT gauge invariant
    a = np.array([ip(psi[:, n], F * Om) for n in range(r)])
    m = np.log(lam[0] / lam[1])
    print(f" limit      m = ln(lambda_0/lambda_1) = {m:.6f}")
    for t in (1, 2, 3):
        CF = float(np.sum((lam[1:r] / lam[0]) ** t * np.abs(a[1:]) ** 2))
        row = []
        for N in (8, 16, 32, 64):
            TN = np.linalg.matrix_power(T / lam[0], N)
            two = np.trace(np.diag(F) @ np.linalg.matrix_power(T / lam[0], t) @ np.diag(F)
                           @ np.linalg.matrix_power(T / lam[0], N - t)) / np.trace(TN)
            one = np.trace(np.diag(F) @ TN) / np.trace(TN)
            row.append(two - one ** 2)
        bound = np.max(np.abs(F)) ** 2 * np.exp(-m * t)
        print(f"   t={t}: C_F(t)={CF:.10f}; finite N=8,16,32,64: " + ", ".join(f"{x:.10f}" for x in row)
              + f"; 0<=C_F<=||F||^2 e^(-mt)={bound:.6f}: {0 <= CF <= bound}")
    # F = psi_1/Omega
    F = psi[:, 1] / Om
    a = np.array([ip(psi[:, n], F * Om) for n in range(r)])
    for t in (1, 3):
        CF = float(np.sum((lam[1:r] / lam[0]) ** t * np.abs(a[1:]) ** 2))
        print(f"   F=psi_1/Omega, t={t}: C_F(t) = {CF:.12f}, e^(-mt) = {np.exp(-m*t):.12f}")


if __name__ == "__main__":
    beta = 0.7
    # D = 2 ring (V = 0, M = 1)
    o, lam, vec = run((3,), 3, beta)
    L = 3
    print(f"   analytic D=2 Z2: cosh^L={np.cosh(beta)**L:.9f}, sinh^L={np.sinh(beta)**L:.9f};"
          f" kernel values cosh^L+-sinh^L = {np.cosh(beta)**L+np.sinh(beta)**L:.6f}, {np.cosh(beta)**L-np.sinh(beta)**L:.6f}")
    limit_check(o, lam, vec, beta)
    run((3,), 4, beta)
    run((4,), 3, beta)
    # D = 3 with spatial plaquettes (V != 0).  Sizes 2 and 1 violate "all sizes >= 3" but the
    # algebra (2.1) is the same with plaquettes labelled (x;mu,nu); needed to keep brute force feasible.
    o, lam, vec = run((2, 2), 2, beta)
    limit_check(o, lam, vec, beta)
    run((2, 1), 3, beta)
    run((2, 1), 4, 1.3)
