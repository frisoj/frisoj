"""Second-round referee check of BEWIJZEN.md, Stelling B points 1-4 (and the D = 2 case of
Stelling A points 1 and 5), on finite NON-ABELIAN subgroups of SU(2) and on honest lattices
(ring of L = 3 sites, N >= 3 time slices).  Every integral is a finite sum: exact to rounding.

Run from /home/user/frisoj/yang-mills:  python3 review/proofs/ref_b_r2_finite_groups.py

What is independent of the proof here: the matrix TFULL is built DIRECTLY from the plaquette
action of section 1.2/1.3, with the time links summed explicitly,

    TFULL(u, u') = |G|^-L sum_{v in G^L} prod_i k( u_i v_{i+1} u'_i^-1 v_i^-1 ),

so that Z = Tr (TFULL/|G|^L ...)^N is the partition function by mere bookkeeping (no gauge
transformations, no projection P, no characters).  It is then compared with

    K P                                  (section 2.2 with M = 1: step 1 and step 4 of Stelling A),
    rank P = number of conjugacy classes (point 1),
    spectrum {(c_rho/d_rho)^L}, eigenfunctions chi_rho o h (point 2),
    Z = sum_rho (c_rho/d_rho)^(L N)      (point 4),
    <chi(h^0) chi(h^t)> = sum_{rho,sigma} n_{rho sigma} Lam_rho^t Lam_sigma^(N-t) / Z
                                         (Stelling A point 5 in the eigenbasis of Stelling B),
where n_{rho sigma} = <chi_sigma, chi_fund chi_rho> are the fusion multiplicities.

Groups: Q8 (order 8; characters real) and the dicyclic group Dic3 (order 12; two 2-dimensional
irreducible representations and two complex 1-dimensional characters).
"""
import itertools
import numpy as np

ok_all = True


def report(name, value, tol):
    global ok_all
    ok = abs(value) <= tol
    ok_all &= ok
    print("  %-72s %.3e  (tol %.0e)  %s" % (name, value, tol, "ok" if ok else "FAIL"))


def qmul(a, b):
    """Quaternions (a0, a) <-> a0 + i a.sigma, as in ym/lattice.py; (1/2) Tr = a0."""
    a0, av = a[..., :1], a[..., 1:]
    b0, bv = b[..., :1], b[..., 1:]
    return np.concatenate([a0 * b0 - np.sum(av * bv, axis=-1, keepdims=True),
                           a0 * bv + b0 * av - np.cross(av, bv)], axis=-1)


def tables(elems):
    n = len(elems)
    prod = qmul(elems[:, None, :], elems[None, :, :])
    dist = np.linalg.norm(prod[:, :, None, :] - elems[None, None, :, :], axis=-1)
    assert np.max(np.min(dist, axis=-1)) < 1e-12, "set is not closed under multiplication"
    mult = np.argmin(dist, axis=-1)
    ident = int(np.argmin(np.linalg.norm(elems - np.array([1.0, 0, 0, 0]), axis=1)))
    inv = np.array([int(np.where(mult[i] == ident)[0][0]) for i in range(n)])
    return mult, inv


def n_classes(mult, inv):
    n = len(inv)
    seen, c = np.zeros(n, dtype=bool), 0
    for i in range(n):
        if not seen[i]:
            seen[[int(mult[mult[g, i], inv[g]]) for g in range(n)]] = True
            c += 1
    return c


def run(name, elems, chars, beta, Ns):
    global ok_all
    print("%s (order %d), ring of L = 3 sites, beta = %g" % (name, len(elems), beta))
    n, L = len(elems), 3
    mult, inv = tables(elems)
    htr = elems[:, 0]
    k = np.exp(beta * htr)                                        # k(a) = exp((beta/2) Tr a)
    dims = [int(round(ch[int(np.argmax(htr))].real)) for ch in chars]
    gram = np.array([[np.mean(np.conj(a) * b) for b in chars] for a in chars])
    report("characters orthonormal, sum d^2 = |G|, #characters = #classes",
           np.max(np.abs(gram - np.eye(len(chars)))) + abs(sum(d * d for d in dims) - n)
           + abs(len(chars) - n_classes(mult, inv)), 1e-13)

    conf = np.array(list(itertools.product(range(n), repeat=L)))
    nconf = len(conf)
    # ---- TFULL from the plaquette action: M[a, b, v, v'] = k(a v' b^-1 v^-1)
    a_, b_, v_, w_ = np.meshgrid(np.arange(n), np.arange(n), np.arange(n), np.arange(n), indexing="ij")
    M = k[mult[mult[mult[a_, w_], inv[b_]], inv[v_]]]             # (a, b, v, v')
    # sum_{v1,v2,v3} M[u1,u1',v1,v2] M[u2,u2',v2,v3] M[u3,u3',v3,v1]
    MM = np.einsum("abvw,cdwx->acbdvx", M, M)                     # (u2,u3,u2',u3',v2,v1)
    A = M.reshape(n * n, n * n)                                   # rows (u1,u1'), cols (v1,v2)
    B = MM.transpose(0, 1, 2, 3, 5, 4).reshape(n ** 4, n * n)     # cols (v1,v2)
    T6 = (A @ B.T).reshape(n, n, n, n, n, n)                      # (u1,u1',u2,u3,u2',u3')
    TFULL = T6.transpose(0, 2, 3, 1, 4, 5).reshape(nconf, nconf) / n ** L   # Haar-normalised v-sum
    TM = TFULL / n ** L                                           # matrix incl. the measure du'

    # ---- K and P of section 2.2 (M = 1 in D = 2)
    K = np.ones((nconf, nconf))
    for i in range(L):
        K *= k[mult[conf[:, i][:, None], inv[conf[:, i]][None, :]]]
    K /= n ** L
    P = np.zeros((nconf, nconf))
    rows = np.arange(nconf)
    for g in itertools.product(range(n), repeat=L):
        ug = [mult[mult[g[i], conf[:, i]], inv[g[(i + 1) % L]]] for i in range(L)]
        np.add.at(P, (rows, (ug[0] * n + ug[1]) * n + ug[2]), 1.0 / n ** L)
    report("T built from the plaquette action = K P (and = P K)",
           max(np.max(np.abs(TM - K @ P)), np.max(np.abs(TM - P @ K))), 1e-13)
    report("P is an orthogonal projection (P^2 = P = P^T)",
           max(np.max(np.abs(P @ P - P)), np.max(np.abs(P - P.T))), 1e-13)
    report("point 1: rank P - number of conjugacy classes",
           np.linalg.matrix_rank(P, tol=1e-9) - n_classes(mult, inv), 0)
    hol = mult[mult[conf[:, 0], conf[:, 1]], conf[:, 2]]
    counts = np.bincount(hol, minlength=n)
    report("point 1: h(u) is uniformly (Haar) distributed over G", np.max(np.abs(counts / nconf - 1.0 / n)), 1e-15)

    # ---- point 2
    lam = np.array([((np.mean(k * np.conj(ch)) / d) ** L).real for ch, d in zip(chars, dims)])
    worst = max(np.max(np.abs(TM @ ch[hol] - l * ch[hol])) for ch, l in zip(chars, lam))
    report("point 2: T (chi_rho o h) = (c_rho/d_rho)^L chi_rho o h", worst, 1e-13)
    ev = np.sort(np.linalg.eigvalsh(0.5 * (TM + TM.T)))[::-1]
    report("point 2/3: nonzero spectrum of T = {(c_rho/d_rho)^L}",
           np.max(np.abs(ev[:len(lam)] - np.sort(lam)[::-1])) + np.max(np.abs(ev[len(lam):])), 1e-12)
    print("     (c_rho/d_rho)^L:", "  ".join("%.6f" % x for x in np.sort(lam)[::-1]), "  all > 0:", bool(np.all(lam > 0)))

    # ---- point 4 and the correlator
    fund = 2.0 * htr                                              # chi_{1/2} = Tr
    fus = np.array([[np.mean(np.conj(cs) * fund * cr).real for cr in chars] for cs in chars])
    report("fusion multiplicities <chi_sigma, Tr chi_rho> are integers", np.max(np.abs(fus - np.round(fus))), 1e-13)
    F = fund[hol]
    for N in Ns:
        Tn = {0: np.eye(nconf)}
        for t in range(1, N + 1):
            Tn[t] = Tn[t - 1] @ TM
        Z = np.trace(Tn[N])
        Zpred = np.sum(lam ** N)
        dev = abs(Z - Zpred) / Zpred
        worst = 0.0
        vals = []
        for t in range(1, N):
            direct = np.sum((F[:, None] * Tn[t]) * (F[:, None] * Tn[N - t]).T) / Z   # Tr(F T^t F T^(N-t))/Z
            pred = sum(fus[s, r] * lam[s] ** t * lam[r] ** (N - t)
                       for r in range(len(lam)) for s in range(len(lam))) / Zpred
            worst = max(worst, abs(direct - pred))
            vals.append(direct)
        ok = dev < 1e-12 and worst < 1e-12
        ok_all &= ok
        print("  N = %d: Z = %.12f, sum_rho Lam^N = %.12f (rel. dev %.1e);  <Tr h^0 Tr h^t>, t=1..%d: %s  "
              "max dev from formula %.1e  %s" % (N, Z, Zpred, dev, N - 1,
                                                " ".join("%.6f" % v for v in vals), worst, "ok" if ok else "FAIL"))


e = np.eye(4)
Q8 = np.concatenate([e, -e])
sgn = [lambda q: 1.0,
       lambda q: 1.0 if abs(q[2]) + abs(q[3]) < 1e-9 else -1.0,
       lambda q: 1.0 if abs(q[1]) + abs(q[3]) < 1e-9 else -1.0,
       lambda q: 1.0 if abs(q[1]) + abs(q[2]) < 1e-9 else -1.0]
chars_q8 = [np.array([f(q) for q in Q8]) for f in sgn] + [2.0 * Q8[:, 0]]
run("Q8", Q8, chars_q8, 1.3, (3, 4, 5))

# Dic3 = { a^m, a^m j : m = 0..5 },  a = exp(i pi/3 sigma_3),  j = i sigma_2
a = np.array([np.cos(np.pi / 3), 0.0, 0.0, np.sin(np.pi / 3)])
j = np.array([0.0, 0.0, 1.0, 0.0])
pw = [np.array([1.0, 0, 0, 0])]
for m in range(5):
    pw.append(qmul(pw[-1], a))
dic3 = np.array(pw + [qmul(p, j) for p in pw])
m_idx = np.arange(6)
sg = (-1.0) ** m_idx
chars_d3 = [np.concatenate([np.ones(6), np.ones(6)]).astype(complex),
            np.concatenate([np.ones(6), -np.ones(6)]).astype(complex),
            np.concatenate([sg, 1j * sg]),
            np.concatenate([sg, -1j * sg]),
            np.concatenate([2 * np.cos(np.pi * m_idx / 3), np.zeros(6)]).astype(complex),
            np.concatenate([2 * np.cos(2 * np.pi * m_idx / 3), np.zeros(6)]).astype(complex)]
run("Dic3", dic3, chars_d3, 2.0, (3, 4))

print("ALL OK" if ok_all else "SOME CHECK FAILED")
