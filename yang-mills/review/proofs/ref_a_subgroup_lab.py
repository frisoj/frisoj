#!/usr/bin/env python3
"""Referee check of Stelling A (BEWIJZEN.md, section 2) with G a finite NON-ABELIAN
subgroup of SU(2): the quaternion group Q8 (8 elements) and the binary tetrahedral
group 2T (24 elements).  Haar measure = normalised counting measure, weight
w = exp((beta/2) sum_p Tr U_p) with the 2x2 trace, exactly the formulas of the document.

Purpose: Z2 is abelian, so it cannot detect a wrong order of factors, a wrong inverse,
a wrong orientation of the temporal plaquette or a wrong composition rule (u^g)^h = u^{hg}.
A non-abelian finite group can, and everything is still a finite matrix:
  * full lattice, plaquette U_p = U_{x,mu} U_{x+mu,nu} U_{x+nu,mu}^{-1} U_{x,nu}^{-1} (sec. 1.2),
    brute-force sum over all configurations;
  * M, K, P, T = M K P M from sec. 2.2; kernel of step 4; trace formulas of steps 4 and 8.
Lattice sizes 1 and 2 are used to keep brute force feasible (the document assumes >= 3;
the algebra of (2.1) does not depend on that as long as plaquettes are labelled (x;mu,nu)).

Run:  python3 review/proofs/ref_a_subgroup_lab.py     (from yang-mills/)
"""
import itertools
import numpy as np

np.set_printoptions(linewidth=140, precision=6)


def quat_to_mat(q):
    a0, a1, a2, a3 = q
    return np.array([[a0 + 1j * a3, a2 + 1j * a1], [-a2 + 1j * a1, a0 - 1j * a3]])


def make_group(name):
    if name == "Q8":
        qs = []
        for i in range(4):
            for s in (1, -1):
                q = [0, 0, 0, 0]
                q[i] = s
                qs.append(q)
    elif name == "2T":
        qs = []
        for i in range(4):
            for s in (1, -1):
                q = [0, 0, 0, 0]
                q[i] = s
                qs.append(q)
        for signs in itertools.product((0.5, -0.5), repeat=4):
            qs.append(list(signs))
    else:
        raise ValueError(name)
    mats = np.array([quat_to_mat(q) for q in qs])
    n = len(mats)
    # sanity: SU(2)
    for m in mats:
        assert np.allclose(m.conj().T @ m, np.eye(2)) and abs(np.linalg.det(m) - 1) < 1e-12
    def find(m):
        d = np.max(np.abs(mats - m), axis=(1, 2))
        j = int(np.argmin(d))
        assert d[j] < 1e-12, "not closed"
        return j
    mul = np.array([[find(mats[a] @ mats[b]) for b in range(n)] for a in range(n)], dtype=np.int16)
    inv = np.array([find(mats[a].conj().T) for a in range(n)], dtype=np.int16)
    tr = np.array([np.trace(m).real for m in mats])
    assert np.max(np.abs([np.trace(m).imag for m in mats])) < 1e-12
    return dict(name=name, n=n, mul=mul, inv=inv, tr=tr, mats=mats)


class Lattice:
    def __init__(self, shape):
        self.shape = tuple(shape)
        self.D = len(shape)
        self.sites = list(itertools.product(*[range(k) for k in shape]))
        self.sidx = {s: i for i, s in enumerate(self.sites)}
        self.links = [(s, mu) for s in self.sites for mu in range(self.D)]
        self.lidx = {l: i for i, l in enumerate(self.links)}
        self.plaq = []
        for s in self.sites:
            for mu in range(self.D):
                for nu in range(mu + 1, self.D):
                    self.plaq.append((self.lidx[(s, mu)], self.lidx[(self.shift(s, mu), nu)],
                                      self.lidx[(self.shift(s, nu), mu)], self.lidx[(s, nu)]))

    def shift(self, s, mu):
        s = list(s)
        s[mu] = (s[mu] + 1) % self.shape[mu]
        return tuple(s)


def digits(idx, n, nl):
    """list of nl int arrays: digit l of idx in base n = group element on link l."""
    out = []
    x = idx.copy()
    for _ in range(nl):
        out.append((x % n).astype(np.int16))
        x //= n
    return out


def trace_sum(G, lat, dig):
    """sum_p Tr U_p with the plaquette convention of sec. 1.2."""
    mul, inv, tr = G["mul"], G["inv"], G["tr"]
    tot = np.zeros(dig[0].shape)
    for (a, b, c, d) in lat.plaq:
        up = mul[mul[mul[dig[a], dig[b]], inv[dig[c]]], inv[dig[d]]]
        tot += tr[up]
    return tot


def slice_objects(G, sshape, beta):
    n, mul, inv, tr = G["n"], G["mul"], G["inv"], G["tr"]
    ls = Lattice(sshape)
    nE, nS = len(ls.links), len(ls.sites)
    nC = n ** nE
    cfg = np.arange(nC, dtype=np.int64)
    dig = digits(cfg, n, nE)
    V = -(beta / 2) * trace_sum(G, ls, dig) if ls.plaq else np.zeros(nC)
    # K(u,u') = prod_e k(u_e (u'_e)^{-1}),  k(h) = exp((beta/2) Tr h)
    logK = np.zeros((nC, nC))
    for e in range(nE):
        h = mul[dig[e][:, None], inv[dig[e]][None, :]]
        logK += (beta / 2) * tr[h]
    Kker = np.exp(logK)
    # gauge transformations: (u^g)_(x,i) = g_x u_(x,i) g_{x+i}^{-1}
    def transform(g_digits):
        out = np.zeros(nC, dtype=np.int64)
        for (s, i), e in ls.lidx.items():
            gx = g_digits[ls.sidx[s]]
            gy = g_digits[ls.sidx[ls.shift(s, i)]]
            new = mul[mul[gx, dig[e]], inv[gy]]
            out += new.astype(np.int64) * n ** e
        return out
    gauge_maps = []
    for gi in range(n ** nS):
        gd = [(gi // n ** k) % n for k in range(nS)]
        gauge_maps.append(transform(gd))
    nG = len(gauge_maps)
    P = np.zeros((nC, nC))
    T0 = np.zeros((nC, nC))
    for gm in gauge_maps:
        P[cfg, gm] += 1.0 / nG              # (Pf)(u) = mean_g f(u^g)
        T0 += Kker[gm, :] / nG              # T0(u,u') = mean_g K(u^g,u')
    M = np.diag(np.exp(-V / 2))
    Kop = Kker / nC
    T = M @ Kop @ P @ M
    Tker = np.exp(-V / 2)[:, None] * T0 * np.exp(-V / 2)[None, :]
    return dict(ls=ls, nE=nE, nS=nS, nC=nC, V=V, Kker=Kker, Kop=Kop, P=P, M=M, T=T, T0=T0, Tker=Tker,
                gauge_maps=gauge_maps, transform=transform)


def run(G, sshape, N, beta, seed=3, chunk=1 << 22):
    rng = np.random.default_rng(seed)
    n = G["n"]
    o = slice_objects(G, sshape, beta)
    P, M, Kop, T, Tker, nC, ls = o["P"], o["M"], o["Kop"], o["T"], o["Tker"], o["nC"], o["ls"]
    err = lambda A, B: float(np.max(np.abs(A - B)))
    print(f"\n=== G={G['name']} (|G|={n}), spatial shape {sshape}, N={N}, beta={beta}: |E|={o['nE']}, |C|={nC},"
          f" spatial plaquettes={len(ls.plaq)}, V range [{o['V'].min():.3f},{o['V'].max():.3f}] ===")
    # composition rule (u^g)^h = u^{hg} on all u for random g, h
    nS = o["nS"]
    g = [int(x) for x in rng.integers(0, n, nS)]
    h = [int(x) for x in rng.integers(0, n, nS)]
    hg = [int(G["mul"][h[k], g[k]]) for k in range(nS)]
    gh = [int(G["mul"][g[k], h[k]]) for k in range(nS)]
    ug = o["transform"](g)
    ugh = o["transform"](h)[ug]          # index of (u^g)^h: apply h-map to the configuration u^g
    print(f" sec 2.1    (u^g)^h == u^(hg): {bool(np.all(ugh == o['transform'](hg)))};"
          f"   (u^g)^h == u^(gh) [wrong order, should be False for non-abelian]: {bool(np.all(ugh == o['transform'](gh)))}")
    print(f" step 2(a)  P^2=P: {err(P @ P, P):.2e}   P=P^T: {err(P, P.T):.2e}   rank P = {int(round(np.trace(P)))}")
    print(f" step 2(b)  MP=PM: {err(M @ P, P @ M):.2e}")
    print(f" step 2(c)  K sym: {err(Kop, Kop.T):.2e}   KP=PK: {err(Kop @ P, P @ Kop):.2e}")
    ek = np.linalg.eigvalsh(Kop)
    print(f" step 3     K eigenvalues: min {ek.min():.3e}, max {ek.max():.3e}")
    print(f" step 4     T=MKPM vs MPKM: {err(T, M @ P @ Kop @ M):.2e}   vs P(MKM)P: {err(T, P @ M @ Kop @ M @ P):.2e}"
          f"   vs kernel/|C|: {err(T, Tker / nC):.2e}   kernel sym: {err(Tker, Tker.T):.2e}   min kernel: {Tker.min():.5f}")
    # brute force on the full lattice
    full = Lattice(tuple(sshape) + (N,))
    nl = len(full.links)
    ntot = n ** nl
    F1 = rng.normal(size=nC) + 1j * rng.normal(size=nC)
    F2 = rng.normal(size=nC) + 1j * rng.normal(size=nC)
    Zsum = 0.0
    c1 = 0.0
    c2 = np.zeros(N, dtype=complex)
    slice_links = [[(full.lidx[(tuple(s) + (t,), i)], e) for (s, i), e in ls.lidx.items()] for t in range(N)]
    for start in range(0, ntot, chunk):
        idx = np.arange(start, min(start + chunk, ntot), dtype=np.int64)
        dig = digits(idx, n, nl)
        w = np.exp((beta / 2) * trace_sum(G, full, dig))
        Zsum += w.sum()
        ut = []
        for t in range(N):
            code = np.zeros(idx.shape, dtype=np.int64)
            for (l, e) in slice_links[t]:
                code += dig[l].astype(np.int64) * n ** e
            ut.append(code)
        c1 += np.sum(w * F1[ut[0]])
        for t in range(1, N):
            c2[t] += np.sum(w * F1[ut[0]] * F2[ut[t]])
    Zbrute = Zsum / ntot
    TN = np.linalg.matrix_power(T, N)
    Ztr = np.trace(TN)
    print(f" step 4     Z brute force ({ntot} configs, {len(full.plaq)} plaquettes) = {Zbrute:.12f}   Tr T^N = {Ztr:.12f}"
          f"   rel.diff {abs(Zbrute - Ztr) / Zbrute:.2e}")
    worst = 0.0
    wrong = 0.0
    for t in range(1, N):
        tr = np.trace(np.diag(F1) @ np.linalg.matrix_power(T, t) @ np.diag(F2) @ np.linalg.matrix_power(T, N - t)) / Ztr
        worst = max(worst, abs(c2[t] / Zsum - tr))
    print(f" step 8     mu(F1(u^0)F2(u^t)) vs Tr(F1 T^t F2 T^(N-t))/Tr T^N, t=1..{N-1}: max diff {worst:.2e};"
          f"   one-point: {abs(c1 / Zsum - np.trace(np.diag(F1) @ TN) / Ztr):.2e}")
    lam, vec = np.linalg.eigh(T)
    lam, vec = lam[::-1], vec[:, ::-1]
    r = int(round(np.trace(P)))
    om = vec[:, 0] * np.sign(vec[0, 0]) * np.sqrt(nC)
    print(f" step 5/6   #eig>1e-12: {int(np.sum(lam > 1e-12))} (rank P {r}); min eig on H: {lam.min():.1e}; smallest on H_inv: {lam[r-1]:.3e};"
          f" top: {lam[:3]}; lambda_1/lambda_0={lam[1]/lam[0]:.6f}; min Omega={om.min():.5f}")


if __name__ == "__main__":
    Q8 = make_group("Q8")
    T24 = make_group("2T")
    beta = 0.9
    run(Q8, (2,), 2, beta)          # D=2 ring with 2 sites, 8 links on the full lattice
    run(Q8, (1,), 3, beta)          # D=2, one spatial loop, gauge action u -> g u g^-1
    run(Q8, (1,), 4, beta)
    run(Q8, (1, 1), 2, beta)        # D=3, spatial plaquette = commutator, V != 0
    run(T24, (1,), 2, beta)
    run(T24, (1,), 3, beta)
    run(T24, (1, 1), 2, beta)       # D=3 with 2T: 24^6 = 1.9e8 full configurations
