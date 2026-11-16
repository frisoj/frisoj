"""Referee check of BEWIJZEN.md, Stelling B points 1, 2, 4 and the correlator formula of
Stelling A point 5, on FINITE subgroups of SU(2), where every integral is a finite sum and the
statements can be tested to rounding error without any Bessel function.

Run from the repository root:  python3 review/proofs/ref_b_finite_group.py

The algebra of the proof (change of variables to the holonomy, substitution a_i = u_i u_i'^-1,
Schur's lemma) uses only: G compact, k a class function, chi the character of an IRREDUCIBLE
representation.  For a finite subgroup G of SU(2) with normalised counting measure the proof
therefore predicts

    dim H_inv = number of conjugacy classes,   H_inv = { phi o h : phi class function },
    T (chi_rho o h) = (c_rho / d_rho)^L chi_rho o h,   c_rho = |G|^-1 sum_a k(a) chi_rho(a),
    Z = sum_rho (c_rho/d_rho)^(L N)                      (torus, no dimension factors),
    <chi(h^0) chi(h^t)> = Tr(F T^t F T^(N-t)) / Tr T^N   (F = multiplication by chi_{1/2} o h).

Checks:
  A. Q8 (quaternion group, 8 elements, non-abelian), L = 3: the full 512 x 512 matrices of
     K, P, T = K P;  rank P, range of P, spectrum of T, eigenfunctions.
  B. Binary icosahedral group 2I (120 elements), L = 3: (K chi_j o h)(u) at random u for
     2j = 0..5 (where D^j restricted to 2I is irreducible) and 2j = 6 (reducible: must fail).
  C. Brute-force sums over ALL lattice configurations (no transfer matrix, no gauge fixing):
     Q8 on a 2 x 2 torus (8^8 configurations) and the centre Z2 = {+1,-1} on a 3 x 3 torus
     (2^18 configurations): Z and the Polyakov-loop correlator against the formulas above.
"""
import itertools
import numpy as np
from scipy.special import eval_chebyu

rng = np.random.default_rng(20261113)
ok_all = True


def report(name, value, tol):
    global ok_all
    ok = abs(value) <= tol
    ok_all &= ok
    print("  %-66s %.3e  (tol %.0e)  %s" % (name, value, tol, "ok" if ok else "FAIL"))


def qmul(a, b):
    """Quaternion product (arrays (...,4)), q = (a0, a) <-> a0 + i a.sigma; (1/2) Tr = a0."""
    a0, av = a[..., :1], a[..., 1:]
    b0, bv = b[..., :1], b[..., 1:]
    return np.concatenate([a0 * b0 - np.sum(av * bv, axis=-1, keepdims=True),
                           a0 * bv + b0 * av - np.cross(av, bv)], axis=-1)


def qinv(a):
    return a * np.array([1.0, -1.0, -1.0, -1.0])


def group_tables(elems):
    """Multiplication table, inverse table and half-trace of a finite set of unit quaternions."""
    n = len(elems)
    prod = qmul(elems[:, None, :], elems[None, :, :])
    d = np.linalg.norm(prod[:, :, None, :] - elems[None, None, :, :], axis=-1)
    mult = np.argmin(d, axis=-1)
    assert np.max(np.min(d, axis=-1)) < 1e-9, "not closed under multiplication"
    ident = int(np.argmin(np.linalg.norm(elems - np.array([1.0, 0, 0, 0]), axis=1)))
    inv = np.array([int(np.where(mult[i] == ident)[0][0]) for i in range(n)])
    return mult, inv, elems[:, 0].copy(), ident


def conjugacy_classes(mult, inv):
    n = len(inv)
    cls = -np.ones(n, dtype=int)
    c = 0
    for i in range(n):
        if cls[i] < 0:
            orbit = {int(mult[mult[g, i], inv[g]]) for g in range(n)}
            cls[list(orbit)] = c
            c += 1
    return cls, c


# ------------------------------------------------------------------------------------------
print("A. Q8, L = 3: full matrices of K, P, T = K P on the 512-dimensional space")
e = np.eye(4)
Q8 = np.concatenate([e, -e])
mult, inv, htr, ident = group_tables(Q8)
cls, ncls = conjugacy_classes(mult, inv)
n, L, beta = 8, 3, 1.3
k = np.exp(beta * htr)                                   # k(a) = exp((beta/2) Tr a)
conf = np.array(list(itertools.product(range(n), repeat=L)))        # all u in G^L
idx = {tuple(c): i for i, c in enumerate(conf)}
nconf = len(conf)
# K(u,u') = prod_i k(u_i u_i'^-1) with normalised counting measure (1/n^L)
K = np.ones((nconf, nconf))
for i in range(L):
    K *= k[mult[conf[:, i][:, None], inv[conf[:, i]][None, :]]]
K /= n ** L
# (P f)(u) = n^-L sum_g f(u^g),  (u^g)_i = g_i u_i g_{i+1}^-1
P = np.zeros((nconf, nconf))
for g in itertools.product(range(n), repeat=L):
    ug = np.stack([mult[mult[g[i], conf[:, i]], inv[g[(i + 1) % L]]] for i in range(L)], axis=1)
    cols = ug[:, 0] * n * n + ug[:, 1] * n + ug[:, 2]
    np.add.at(P, (np.arange(nconf), cols), 1.0 / n ** L)
hol = mult[mult[conf[:, 0], conf[:, 1]], conf[:, 2]]      # h(u) = u1 u2 u3
report("P^2 = P", np.max(np.abs(P @ P - P)), 1e-12)
report("P = P^T", np.max(np.abs(P - P.T)), 1e-12)
report("K P = P K", np.max(np.abs(K @ P - P @ K)), 1e-12)
report("rank P - number of conjugacy classes (%d)" % ncls, np.linalg.matrix_rank(P, tol=1e-9) - ncls, 0)
# range of P = functions of the class of the holonomy: P 1_{class(h)=c} = 1_{class(h)=c}
ind = np.stack([(cls[hol] == c).astype(float) for c in range(ncls)], axis=1)
report("P (phi o h) = phi o h for class indicators phi", np.max(np.abs(P @ ind - ind)), 1e-12)
# norm identity: |G|^-L sum_u |phi(h(u))|^2 = |G|^-1 sum_h |phi(h)|^2
lhs = ind.sum(axis=0) / nconf
rhs = np.array([(cls == c).sum() for c in range(ncls)]) / n
report("h(u) is Haar (uniformly) distributed: norm identity", np.max(np.abs(lhs - rhs)), 1e-14)
# character table of Q8: four 1-dim (trivial on the centre) and the 2-dim one, chi = Tr
ab = [lambda q: 1.0,
      lambda q: 1.0 if abs(q[2]) + abs(q[3]) < 1e-9 else -1.0,     # kernel {+-1, +-i}
      lambda q: 1.0 if abs(q[1]) + abs(q[3]) < 1e-9 else -1.0,     # kernel {+-1, +-j}
      lambda q: 1.0 if abs(q[1]) + abs(q[2]) < 1e-9 else -1.0]     # kernel {+-1, +-k}
chars = [np.array([f(q) for q in Q8]) for f in ab] + [2.0 * htr]
dims = [1, 1, 1, 1, 2]
gram = np.array([[np.mean(a * b) for b in chars] for a in chars])
report("characters of Q8 orthonormal", np.max(np.abs(gram - np.eye(5))), 1e-14)
T = K @ P
pred = sorted([(np.mean(k * ch) / d) ** L for ch, d in zip(chars, dims)], reverse=True)
ev = np.sort(np.linalg.eigvalsh(0.5 * (T + T.T)))[::-1]
report("T symmetric", np.max(np.abs(T - T.T)), 1e-12)
report("5 largest eigenvalues of T - (c_rho/d_rho)^L", np.max(np.abs(ev[:5] - np.array(pred))), 1e-12)
report("all other eigenvalues of T vanish", np.max(np.abs(ev[5:])), 1e-12)
worst = 0.0
for ch, d in zip(chars, dims):
    f = ch[hol]
    worst = max(worst, np.max(np.abs(T @ f - (np.mean(k * ch) / d) ** L * f)))
report("T (chi_rho o h) = (c_rho/d_rho)^L chi_rho o h", worst, 1e-12)
print("     eigenvalues (c_rho/d_rho)^L:", "  ".join("%.6f" % p for p in pred))

# ------------------------------------------------------------------------------------------
print("B. binary icosahedral group (120 elements), L = 3: (K chi_j o h)(u) at random u")
phi = (1 + np.sqrt(5)) / 2
els = [s * e[i] for i in range(4) for s in (1, -1)]
els += [0.5 * np.array(s) for s in itertools.product((1, -1), repeat=4)]
even = [p for p in itertools.permutations(range(4))
        if sum(p[i] > p[j] for i in range(4) for j in range(i + 1, 4)) % 2 == 0]
base = np.array([phi, 1.0, 1.0 / phi, 0.0]) / 2
for p in even:
    for s in itertools.product((1, -1), repeat=3):
        v = base * np.array([s[0], s[1], s[2], 1.0])
        w = np.zeros(4)
        w[list(p)] = v
        els.append(w)
els = np.array(els)
_, first = np.unique(np.round(els, 9), axis=0, return_index=True)   # remove duplicates only;
I120 = els[np.sort(first)]                                          # keep full double precision
assert len(I120) == 120
mult, inv, htr, ident = group_tables(I120)
n, beta = 120, 3.0
k = np.exp(beta * htr)
a = np.arange(n)
worst_irr, dev_red = 0.0, 0.0
for trial in range(3):
    u = rng.integers(n, size=3)
    # u_i' = a_i^-1 u_i; holonomy of u' for all (a1,a2,a3)
    up = [mult[inv[a], u[i]] for i in range(3)]
    h12 = mult[up[0][:, None], up[1][None, :]]
    h = mult[h12[:, :, None], up[2][None, None, :]]
    wgt = k[:, None, None] * k[None, :, None] * k[None, None, :] / n ** 3
    hu = mult[mult[u[0], u[1]], u[2]]
    for twoj in range(0, 7):
        chj = eval_chebyu(twoj, np.clip(htr, -1, 1))           # chi_j = U_{2j}(cos theta)
        lhs = np.sum(wgt * chj[h])
        scale = (np.mean(k * chj) / (twoj + 1)) ** 3            # (c_j/d_j)^3 for the group 2I
        rel = abs(lhs - scale * chj[hu]) / abs(scale)           # deviation in units of the eigenvalue
        if trial == 0:
            cond = np.sum(np.abs(wgt * chj[h])) / abs(scale)    # rounding amplification of the sum
            print("     2j=%d  e_j=(c_j/d_j)^3=%.6e  K chi_j(h)(u)=%+.12e  e_j chi_j(h(u))=%+.12e  "
                  "rel.dev=%.1e (rounding scale %.0e)" % (twoj, scale, lhs, scale * chj[hu], rel, 1e-16 * cond))
        if twoj <= 5:
            worst_irr = max(worst_irr, rel)
        else:
            dev_red = max(dev_red, rel)
report("2j = 0..5 (irreducible on 2I): |K chi_j(h) - e_j chi_j(h)| / e_j", worst_irr, 1e-9)
print("  2j = 6 (7-dim, REDUCIBLE on 2I, Schur does not apply): relative deviation %.3f  %s"
      % (dev_red, "(nonzero, as it must be: the test has teeth)" if dev_red > 1e-3 else "UNEXPECTEDLY ZERO"))
ok_all &= dev_red > 1e-3

# ------------------------------------------------------------------------------------------
print("C. brute force over all configurations of a periodic lattice")


def brute(mult, inv, htr, Lx, Nt, beta):
    """Sum over all configurations of an Lx (space) x Nt (time) torus.  Returns Z (normalised
    counting measure) and <chi(h^0) chi(h^t)>, chi = Tr of the spatial holonomy, t = 0..Nt-1."""
    n = len(inv)
    nl = 2 * Lx * Nt
    # link numbering: spatial u[t][x] = t*Lx + x ; temporal v[t][x] = Lx*Nt + t*Lx + x
    split = nl // 2
    lo = np.array(list(itertools.product(range(n), repeat=split)))       # first half of links
    Z = 0.0
    corr = np.zeros(Nt)
    kk = np.exp(beta * htr)
    for hi in itertools.product(range(n), repeat=nl - split):
        U = np.concatenate([lo, np.tile(np.array(hi), (len(lo), 1))], axis=1)
        us = lambda t, x: U[:, (t % Nt) * Lx + (x % Lx)]
        vt = lambda t, x: U[:, Lx * Nt + (t % Nt) * Lx + (x % Lx)]
        w = np.ones(len(lo))
        for t in range(Nt):
            for x in range(Lx):
                # U_p = u^t_x v^t_{x+1} (u^{t+1}_x)^-1 (v^t_x)^-1   (section 1.2 / step 1)
                p = mult[mult[mult[us(t, x), vt(t, x + 1)], inv[us(t + 1, x)]], inv[vt(t, x)]]
                w = w * kk[p]
        hol = []
        for t in range(Nt):
            hh = us(t, 0)
            for x in range(1, Lx):
                hh = mult[hh, us(t, x)]
            hol.append(2.0 * htr[hh])
        Z += w.sum()
        for t in range(Nt):
            corr[t] += np.sum(w * hol[0] * hol[t])
    return Z / n ** nl, corr / Z


def predicted(chars, dims, fund, kk, Lx, Nt):
    """Z and correlator from Stelling B (finite-group version) and Stelling A point 5."""
    lam = np.array([(np.mean(kk * ch) / d) ** Lx for ch, d in zip(chars, dims)])
    Z = np.sum(lam ** Nt)
    # matrix of multiplication by chi_fund in the orthonormal basis of characters
    F = np.array([[np.mean(a * fund * b) for b in chars] for a in chars])
    Tm = np.diag(lam)
    corr = [np.trace(F @ np.linalg.matrix_power(Tm, t) @ F @ np.linalg.matrix_power(Tm, Nt - t)) / Z
            for t in range(Nt)]
    return Z, np.array(corr)


# Q8 on a 2 x 2 torus
mult, inv, htr, ident = group_tables(Q8)
beta = 1.3
Zb, cb = brute(mult, inv, htr, 2, 2, beta)
Zp, cp = predicted(chars, dims, 2.0 * htr, np.exp(beta * htr), 2, 2)
print("  Q8, 2x2 torus, beta=%.1f:  Z brute = %.12f   sum_rho (c/d)^(LN) = %.12f" % (beta, Zb, Zp))
report("Q8 2x2: Z", Zb - Zp, 1e-11)
print("     correlator t=0,1  brute: %s   formula: %s" % (np.round(cb, 10), np.round(cp, 10)))
report("Q8 2x2: <chi(h^0) chi(h^t)>, t = 0, 1", np.max(np.abs(cb - cp)), 1e-11)

# centre Z2 on a 3 x 3 torus (an honest lattice in the sense of section 1.2: all extents >= 3)
Z2 = np.array([[1.0, 0, 0, 0], [-1.0, 0, 0, 0]])
mult, inv, htr, ident = group_tables(Z2)
beta = 0.9
chars2, dims2 = [np.array([1.0, 1.0]), np.array([1.0, -1.0])], [1, 1]
Zb, cb = brute(mult, inv, htr, 3, 3, beta)
Zp, cp = predicted(chars2, dims2, 2.0 * htr, np.exp(beta * htr), 3, 3)
print("  Z2, 3x3 torus, beta=%.1f:  Z brute = %.12f   cosh^9 + sinh^9 = %.12f" % (beta, Zb, Zp))
report("Z2 3x3: Z", (Zb - Zp) / Zp, 1e-12)
print("     correlator t=0,1,2  brute: %s   formula: %s" % (np.round(cb, 10), np.round(cp, 10)))
report("Z2 3x3: <chi(h^0) chi(h^t)>, t = 0, 1, 2", np.max(np.abs(cb - cp)), 1e-11)

print("ALL OK" if ok_all else "SOME CHECK FAILED")
