#!/usr/bin/env python3
"""Referee round 2, Stelling A (BEWIJZEN.md section 2): Z2 laboratory on lattices that
SATISFY the hypotheses of the theorem (all sizes >= 3), written independently of
ref_a_z2_lab.py (different data layout, different method for Z).

G = Z2 = {+1,-1}, Haar = normalised counting measure, w = exp(beta * sum_p sigma_p)
(the SU(2) weight restricted to the centre).  Z2 tests the algebra, not the SU(2)-specific steps.

Part 1  D = 2 ring, L = 3 and 4, N = 3: everything from the definitions of sec. 1.2 / 2.2 with
        +-1 arrays; Z = Tr T^N and the correlation formula of point 5 against brute force over
        the full lattice; closed form Z = cosh^(LN) + sinh^(LN).
Part 2  D = 3, spatial lattice 3 x 3 (18 spatial links, V != 0), N = 3:
        * T restricted to H_inv as a 1024 x 1024 matrix on gauge orbits (built from the
          kernel of step 4);
        * Z on the full 3 x 3 x 3 lattice (81 links, 81 plaquettes) computed WITHOUT any
          transfer matrix, as cosh^81 * sum over closed plaquette surfaces of tanh^|S|
          (2^29 surfaces, enumerated), compared with Tr T^3;
        * points 2-4: injective on H_inv, lambda_0 simple, Omega > 0, gap;
        * which state is psi_1?  Centre-symmetry sector of psi_1 and decay rate of the
          plaquette correlator (relevant for the lay-language paragraph and section 5.5);
        * min T, max T, lambda_0 (second remark after the proof).

Run:  python3 review/proofs/ref_a_r2_z2_3x3.py     (from yang-mills/; about 40 s)
"""
import itertools
import numpy as np

np.set_printoptions(linewidth=150, precision=6)


# ----------------------------------------------------------------------------- part 1
def ring(L, N, beta, seed):
    rng = np.random.default_rng(seed)
    C = np.array(list(itertools.product((1, -1), repeat=L)), dtype=np.int8)      # spatial configs
    nC = len(C)
    index = {tuple(c): a for a, c in enumerate(C)}
    # (u^g)_i = g_i u_i g_{i+1}^{-1};  (P f)(u) = mean_g f(u^g)
    P = np.zeros((nC, nC))
    for g in C:
        ug = g[None, :] * C * np.roll(g, -1)[None, :]
        for a in range(nC):
            P[a, index[tuple(ug[a])]] += 1.0 / nC
    K = np.exp(beta * (C.astype(float) @ C.T.astype(float))) / nC            # kernel / |C|
    T = K @ P                                                                 # M = 1 (no spatial plaquettes)
    # brute force over the full lattice: sites (i,t); spatial link s[t,i], time link v[t,i];
    # plaquette (x; space, time) = s[t,i] * v[t,i+1] * s[t+1,i] * v[t,i]   (sec. 1.2)
    nl = 2 * L * N
    F1 = rng.normal(size=nC) + 1j * rng.normal(size=nC)
    F2 = rng.normal(size=nC) + 1j * rng.normal(size=nC)
    pw = (2 ** np.arange(L - 1, -1, -1)).astype(np.int64)                     # index of a slice in C
    Zsum, c1, c2 = 0.0, 0.0, np.zeros(N, dtype=complex)
    chunk = 1 << 20
    for start in range(0, 2 ** nl, chunk):
        code = np.arange(start, min(start + chunk, 2 ** nl), dtype=np.int64)
        bits = ((code[:, None] >> np.arange(nl)[None, :]) & 1).astype(np.int8)
        sig = 1 - 2 * bits
        s = sig[:, :L * N].reshape(-1, N, L)
        v = sig[:, L * N:].reshape(-1, N, L)
        plaq = s * np.roll(v, -1, axis=2) * np.roll(s, -1, axis=1) * v
        w = np.exp(beta * plaq.sum(axis=(1, 2)))
        sl = ((s == -1).astype(np.int64) * pw[None, None, :]).sum(axis=2)     # slice index (C order of product)
        Zsum += w.sum()
        c1 += (w * F1[sl[:, 0]]).sum()
        for t in range(1, N):
            c2[t] += (w * F1[sl[:, 0]] * F2[sl[:, t]]).sum()
    Zb = Zsum / 2 ** nl
    Ztr = np.trace(np.linalg.matrix_power(T, N))
    Zcl = np.cosh(beta) ** (L * N) + np.sinh(beta) ** (L * N)
    worst = max(abs(c2[t] / Zsum - np.trace(np.diag(F1) @ np.linalg.matrix_power(T, t) @ np.diag(F2)
                                            @ np.linalg.matrix_power(T, N - t)) / Ztr) for t in range(1, N))
    one = abs(c1 / Zsum - np.trace(np.diag(F1) @ np.linalg.matrix_power(T, N)) / Ztr)
    lam = np.sort(np.linalg.eigvalsh((T + T.T) / 2))[::-1]
    print(f" D=2 ring L={L}, N={N}, beta={beta}: Z brute = {Zb:.12f}, Tr T^N = {Ztr:.12f}, closed form = {Zcl:.12f}")
    print(f"    |T - T^T| = {np.abs(T - T.T).max():.1e}; point 5 (complex, non-invariant F1,F2), max diff over t = {worst:.1e};"
          f" one-point diff = {one:.1e}")
    print(f"    eigenvalues > 1e-12: {int((lam > 1e-12).sum())}, lambda_0 = {lam[0]:.9f} (cosh^L = {np.cosh(beta)**L:.9f}),"
          f" lambda_1 = {lam[1]:.9f} (sinh^L = {np.sinh(beta)**L:.9f}); min kernel = cosh^L - sinh^L = "
          f"{np.cosh(beta)**L - np.sinh(beta)**L:.6f} >= 1")


# ----------------------------------------------------------------------------- part 2
def spatial_3x3(beta):
    Ls = 3
    sites = [(x, y) for x in range(Ls) for y in range(Ls)]
    sid = {s: k for k, s in enumerate(sites)}
    lid = {}
    for s in sites:
        for i in range(2):
            lid[(s, i)] = len(lid)
    nE = len(lid)                                             # 18

    def sh(s, i):
        s = list(s)
        s[i] = (s[i] + 1) % Ls
        return tuple(s)

    plaq = [(lid[(s, 0)], lid[(sh(s, 0), 1)], lid[(sh(s, 1), 0)], lid[(s, 1)]) for s in sites]
    cfg = np.arange(2 ** nE, dtype=np.int64)
    pbits = np.array([((cfg >> a) ^ (cfg >> b) ^ (cfg >> c) ^ (cfg >> d)) & 1 for (a, b, c, d) in plaq])   # (9, 2^18)
    nfrus = pbits.sum(axis=0)
    V = -beta * (9 - 2 * nfrus).astype(float)                 # V = -beta sum_p sigma_p
    # holonomies: row y = 0 in direction 0, column x = 0 in direction 1
    hol0 = np.zeros_like(cfg)
    hol1 = np.zeros_like(cfg)
    for k in range(Ls):
        hol0 ^= (cfg >> lid[((k, 0), 0)]) & 1
        hol1 ^= (cfg >> lid[((0, k), 1)]) & 1
    label = hol0 | (hol1 << 1)
    for k in range(8):                                        # 8 independent plaquettes
        label |= pbits[k] << (2 + k)
    # gauge masks
    masks = set()
    for g in range(2 ** 9):
        m = 0
        for (s, i), e in lid.items():
            m |= (((g >> sid[s]) ^ (g >> sid[sh(s, i)])) & 1) << e
        masks.add(m)
    masks = np.array(sorted(masks), dtype=np.int64)
    assert len(masks) == 256
    # the label is gauge invariant and separates orbits
    for m in masks[:: 17]:
        assert np.array_equal(label[cfg ^ m], label)
    counts = np.bincount(label, minlength=1024)
    assert counts.min() == counts.max() == 256
    reps = np.zeros(1024, dtype=np.int64)
    reps[label[::-1]] = cfg[::-1]                             # smallest configuration of each orbit
    pc = np.zeros(2 ** nE, dtype=np.int64)
    for e in range(nE):
        pc += (cfg >> e) & 1
    wt = np.exp(beta * (nE - 2 * pc))                         # K(u,u') = wt[u xor u']
    Worb = np.zeros(2 ** nE)
    for m in masks:
        Worb += wt[cfg ^ m]
    Worb /= len(masks)                                        # T_0(u,u') = Worb[u xor u']  (step 4)
    X = reps[:, None] ^ reps[None, :]
    T0 = Worb[X]
    ev = np.exp(-V[reps] / 2)
    Tker = ev[:, None] * T0 * ev[None, :]
    Tinv = Tker / 1024.0                                      # T on H_inv in the orbit basis (orbits of equal size)
    return dict(Tinv=Tinv, Tker=Tker, T0=T0, reps=reps, V=V[reps], nfrus=nfrus[reps], label=np.arange(1024),
                lid=lid, sites=sites, cfg=cfg, labels_all=label)


def closed_surface_Z(beta):
    """Z of the 3x3x3 Z2 gauge theory by the character expansion (no transfer matrix)."""
    Ls = 3
    sites = list(itertools.product(range(Ls), repeat=3))
    lid = {}
    for s in sites:
        for mu in range(3):
            lid[(s, mu)] = len(lid)

    def sh(s, mu):
        s = list(s)
        s[mu] = (s[mu] + 1) % Ls
        return tuple(s)

    plaq = []
    for s in sites:
        for mu in range(3):
            for nu in range(mu + 1, 3):
                plaq.append((lid[(s, mu)], lid[(sh(s, mu), nu)], lid[(sh(s, nu), mu)], lid[(s, nu)]))
    nP, nL = len(plaq), len(lid)                              # 81, 81
    B = np.zeros((nL, nP), dtype=np.uint8)                    # boundary map over F2
    for p, ls in enumerate(plaq):
        for l in ls:
            B[l, p] ^= 1
    # kernel of B over F2 by Gaussian elimination
    A = B.copy()
    pivots = []
    r = 0
    for c in range(nP):
        rows = np.nonzero(A[r:, c])[0]
        if len(rows) == 0:
            continue
        A[[r, r + rows[0]]] = A[[r + rows[0], r]]
        for rr in range(nL):
            if rr != r and A[rr, c]:
                A[rr] ^= A[r]
        pivots.append(c)
        r += 1
        if r == nL:
            break
    free = [c for c in range(nP) if c not in pivots]
    basis = []
    for fcol in free:
        x = np.zeros(nP, dtype=np.uint8)
        x[fcol] = 1
        for i, pc in enumerate(pivots):
            x[pc] = A[i, fcol]
        assert not np.any((B @ x) % 2)
        basis.append(x)
    k = len(basis)                                            # expected 29
    lo = np.array([sum(int(b[j]) << j for j in range(64)) for b in basis], dtype=np.uint64)
    hi = np.array([sum(int(b[j]) << (j - 64) for j in range(64, nP)) for b in basis], dtype=np.uint64)

    def span(idx):
        slo = np.zeros(1, dtype=np.uint64)
        shi = np.zeros(1, dtype=np.uint64)
        for i in idx:
            slo = np.concatenate([slo, slo ^ lo[i]])
            shi = np.concatenate([shi, shi ^ hi[i]])
        return slo, shi

    ka = k // 2
    alo, ahi = span(range(ka))
    blo, bhi = span(range(ka, k))
    hist = np.zeros(nP + 1, dtype=np.int64)
    step = 64
    for s0 in range(0, len(alo), step):
        wgt = (np.bitwise_count(alo[s0:s0 + step, None] ^ blo[None, :]).astype(np.int64)
               + np.bitwise_count(ahi[s0:s0 + step, None] ^ bhi[None, :]))
        hist += np.bincount(wgt.ravel(), minlength=nP + 1)
    assert hist.sum() == 2 ** k
    th = np.tanh(beta)
    Z = np.cosh(beta) ** nP * float(np.sum(hist * th ** np.arange(nP + 1)))
    return Z, k, hist


def part2(beta):
    o = spatial_3x3(beta)
    Tinv, Tker = o["Tinv"], o["Tker"]
    print(f"\n D=3, spatial 3x3, beta={beta}: dim H_inv = {Tinv.shape[0]} (= 2^18 / 2^8)")
    print(f"    kernel symmetric: {np.abs(Tker - Tker.T).max():.1e};  min T = {Tker.min():.6e} (> 0),  max T = {Tker.max():.6e},"
          f"  min T_0 = {o['T0'].min():.6f} (Jensen: >= 1)")
    lam, vec = np.linalg.eigh(Tinv)
    lam, vec = lam[::-1], vec[:, ::-1]
    print(f"    spectrum on H_inv: smallest eigenvalue = {lam[-1]:.6e} > 0 (injective, positive);  top: {lam[:6]}")
    om = vec[:, 0] * np.sign(vec[0, 0])
    print(f"    lambda_0 simple: lambda_1/lambda_0 = {lam[1]/lam[0]:.8f};  Omega: min/max = {om.min()/om.max():.6f} (> 0);"
          f"  gap m = {np.log(lam[0]/lam[1]):.6f}")
    Ztr = float(np.sum(lam ** 3))
    Zcs, k, hist = closed_surface_Z(beta)
    print(f"    Z(3x3x3) by closed-surface enumeration (kernel dimension {k}, {2**k} surfaces, no transfer matrix) = {Zcs:.10f}")
    print(f"    Tr T^3 = sum lambda_n^3                                                              = {Ztr:.10f}"
          f"   rel.diff {abs(Zcs - Ztr)/Zcs:.1e}")
    # centre symmetry: flip the links (x,0) with x_0 = 0 (c0) or the links (x,1) with x_1 = 0 (c1).
    # On orbit labels: bit 0 = holonomy in direction 0, bit 1 = holonomy in direction 1.
    lab = np.arange(1024)
    c0 = np.where((lab & 1) == 0, 1.0, -1.0)                 # character "holonomy 0" (a function on orbits)
    c1 = np.where((lab & 2) == 0, 1.0, -1.0)
    # the symmetry operators permute orbits: label -> label xor 1 (resp. xor 2); V and T_0 are invariant
    S0 = np.zeros((1024, 1024)); S0[lab, lab ^ 1] = 1
    S1 = np.zeros((1024, 1024)); S1[lab, lab ^ 2] = 1
    print(f"    centre symmetry commutes with T: {np.abs(S0 @ Tinv - Tinv @ S0).max():.1e}, {np.abs(S1 @ Tinv - Tinv @ S1).max():.1e}")
    # multiplicity of lambda_1 and its sector
    deg = int(np.sum(np.abs(lam - lam[1]) < 1e-9 * lam[0]))
    sub = vec[:, 1:1 + deg]
    e0 = np.linalg.eigvalsh(sub.T @ S0 @ sub)
    e1 = np.linalg.eigvalsh(sub.T @ S1 @ sub)
    print(f"    lambda_1 has multiplicity {deg}; centre parities on its eigenspace: S0 -> {np.round(e0, 6)}, S1 -> {np.round(e1, 6)}")
    # plaquette observable (gauge invariant, centre even, zero momentum): F = sum_p sigma_p = 9 - 2*nfrus
    F = (9 - 2 * o["nfrus"]).astype(float)
    a = vec.T @ (F * om)
    nz = [n for n in range(1, 1024) if abs(a[n]) > 1e-9 * np.linalg.norm(a)]
    n1 = nz[0]
    a_raw = a.copy()
    a = np.where(np.abs(a) > 1e-9 * np.linalg.norm(a), a, 0.0)   # remove rounding-level overlaps (exact zeros by symmetry)
    print(f"    plaquette operator F = sum_p sigma_p:  |<psi_n, F Omega>| for n = 1..4: {np.abs(a_raw[1:5])};  first n >= 1 with overlap: n = {n1}")
    print(f"    decay rate of the plaquette correlator = ln(lambda_0/lambda_{n1}) = {np.log(lam[0]/lam[n1]):.6f}"
          f"   versus   m = ln(lambda_0/lambda_1) = {np.log(lam[0]/lam[1]):.6f}")
    CF = lambda t: float(np.sum((lam[1:] / lam[0]) ** t * a[1:] ** 2))
    print("    effective mass ln(C_F(t)/C_F(t+1)) of the plaquette correlator, t = 1, 5, 20, 60: "
          + ", ".join(f"{np.log(CF(t)/CF(t+1)):.6f}" for t in (1, 5, 20, 60)))
    Fh = c0                                                  # winding loop (torelon operator), centre odd
    ah = vec.T @ (Fh * om)
    ah = np.where(np.abs(ah) > 1e-9 * np.linalg.norm(ah), ah, 0.0)
    CFh = lambda t: float(np.sum((lam[1:] / lam[0]) ** t * ah[1:] ** 2))
    print("    effective mass of the winding-loop (torelon) correlator,    t = 1, 5, 20, 60: "
          + ", ".join(f"{np.log(CFh(t)/CFh(t+1)):.6f}" for t in (1, 5, 20, 60)))
    print(f"    second remark: min T/max T = {Tker.min()/Tker.max():.3e};  min T/lambda_0 = {Tker.min()/lam[0]:.3e};"
          f"  Doeblin: lambda_1/lambda_0 = {lam[1]/lam[0]:.6f} <= 1 - min/max = {1 - Tker.min()/Tker.max():.9f}")


if __name__ == "__main__":
    print("== part 1: D = 2 ring ==")
    ring(3, 3, 0.7, seed=11)
    ring(4, 3, 0.7, seed=12)
    ring(3, 4, 1.1, seed=13)
    print("\n== part 2: D = 3, spatial 3 x 3, N = 3 ==")
    part2(0.4)
    part2(0.7)
