#!/usr/bin/env python3
"""Referee C1 -- BEWIJZEN.md section 4.2 by brute force on finite product spaces.

The lemmas of 4.2 are stated for G^R with a continuous positive density; their proofs use nothing
but a product space with a strictly positive density, so they must hold verbatim for a finite
product space  X = prod_l {0..q_l-1}  with a strictly positive probability mass function p.
Everything below is computed exactly (enumeration), nothing is sampled except the test functions.

For every model:
   rho_l(. | U)   exact conditional distributions,        Pi_l   exact operators,
   c_lk           exact Dobrushin coefficients (max over all pairs differing at k of the TV distance),
and then
   (K1)  Pi_l f independent of U_l, Pi_l 1 = 1, inf f <= Pi_l f <= sup f
   (K2)  pi(Pi_l f) = pi(f)
   C.2   delta_k(Pi_l f) <= delta_k(f) + c_lk delta_l(f)           (random f + exact LP supremum)
   C.3a  W(Pi_l f) <= W(f) - (1-lambda) w_l delta_l(f)             (random f + LP local search)
   C.3b  (1-lambda) sum_i w_{l_i} delta_{l_i}(f_{i-1}) <= W(f)     (random sequences of links)
   C.3c  W(S f) <= lambda W(f) for a round S                       (random f + LP local search),
         the componentwise majorant delta(f_i) <= A_i delta(f_{i-1}) and w.(A_n..A_1 e_j) <= lambda w_j
   C.4   || S^n f - pi(f) || <= alpha^n Delta(f)                   (random f + exact LP supremum)
Weights: w = 1 with lambda = alpha_pi (max row sum), and the sharpest possible choice, the Perron
vector of the matrix c with lambda = spectral radius (also tuned to lambda = 1 exactly), and a
weight vector with zeros (two independent blocks).  Also: what happens for lambda > 1.

Model families: dense random density; Ising on a random graph; 3-state Potts; Z2-gauge-like
(products of 3 or 4 spins); mixed numbers of states.

Run:  python3 review/proofs/ref_c1_framework.py      (from yang-mills/; about 60 s)
"""
import itertools
import sys

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import coo_matrix

TOL = 1e-10


# ------------------------------------------------------------------------------------ model
class Model:
    def __init__(self, p):
        p = np.asarray(p, dtype=float)
        assert p.min() > 0
        self.p = p / p.sum()
        self.n = p.ndim
        self.shape = p.shape
        self.N = p.size
        self.cond = [self.p / self.p.sum(axis=l, keepdims=True) for l in range(self.n)]
        self.c = self._cmat()
        self.alpha = self.c.sum(axis=1).max()
        ev, vec = np.linalg.eig(self.c)
        i = np.argmax(ev.real)
        self.r = ev[i].real
        v = np.abs(vec[:, i].real)
        self.perron = v / v.max()

    def Pi(self, l, f):
        g = (f * self.cond[l]).sum(axis=l, keepdims=True)
        return np.broadcast_to(g, self.shape).copy()

    def delta(self, f):
        return np.array([(f.max(axis=k) - f.min(axis=k)).max() for k in range(self.n)])

    def mean(self, f):
        return float((self.p * f).sum())

    def _cmat(self):
        n = self.n
        c = np.zeros((n, n))
        for l in range(n):
            for k in range(n):
                if k == l:
                    continue
                arr = np.moveaxis(self.cond[l], (k, l), (-2, -1))          # (rest..., U_k, V)
                d = 0.5 * np.abs(arr[..., :, None, :] - arr[..., None, :, :]).sum(axis=-1)
                c[l, k] = d.max()
        return c

    def Pi_matrix(self, l):
        M = np.zeros((self.N, self.N))
        for y in range(self.N):
            e = np.zeros(self.N)
            e[y] = 1.0
            M[:, y] = self.Pi(l, e.reshape(self.shape)).ravel()
        return M

    def pairs(self, k):
        """ordered pairs (x, y) of flat indices of configurations differing only at k"""
        idx = np.arange(self.N).reshape(self.shape)
        I = np.moveaxis(idx, k, -1).reshape(-1, self.shape[k])
        xs, ys = [], []
        for i in range(self.shape[k]):
            for j in range(self.shape[k]):
                if i != j:
                    xs.append(I[:, i])
                    ys.append(I[:, j])
        return np.concatenate(xs), np.concatenate(ys)


# ------------------------------------------------------------------------------------ generators
def spins(shape):
    return [g for g in np.indices(shape)]


def gen_dense(rng, shape):
    G = rng.standard_normal(shape)
    return lambda eps: Model(np.exp(eps * G))


def gen_ising(rng, n):
    s = [2.0 * g - 1 for g in spins((2,) * n)]
    E = np.zeros((2,) * n)
    for i in range(n):
        for j in range(i + 1, n):
            if j == i + 1 or rng.random() < 0.4:
                E += rng.uniform(-1, 1) * s[i] * s[j]
        E += 0.5 * rng.uniform(-1, 1) * s[i]
    return lambda eps: Model(np.exp(eps * E))


def gen_potts(rng, n, q=3):
    s = spins((q,) * n)
    E = np.zeros((q,) * n)
    for i in range(n):
        j = (i + 1) % n
        E += rng.uniform(-1, 1) * (s[i] == s[j])
        if rng.random() < 0.5:
            j2 = int(rng.integers(n))
            if j2 != i:
                E += rng.uniform(-1, 1) * (s[i] == s[j2])
        E += 0.3 * rng.standard_normal(q)[s[i]]
    return lambda eps: Model(np.exp(eps * E))


def gen_gauge(rng, n, npl):
    """Z2-gauge-like: 'plaquettes' are random 3- or 4-subsets of the n 'links', E = sum_p prod sigma"""
    s = [2.0 * g - 1 for g in spins((2,) * n)]
    E = np.zeros((2,) * n)
    for _ in range(npl):
        size = int(rng.choice([3, 4]))
        sub = rng.choice(n, size=min(size, n), replace=False)
        term = np.ones((2,) * n)
        for i in sub:
            term = term * s[i]
        E += term
    return lambda eps: Model(np.exp(eps * E))


def tune(gen, measure, target):
    lo, hi = 0.0, 0.02
    for _ in range(11):                             # eps <= 0.02 * 2^11 = 41 (no overflow)
        if measure(gen(hi)) > target:
            break
        lo, hi = hi, 2 * hi
    for _ in range(45):
        mid = 0.5 * (lo + hi)
        if measure(gen(mid)) > target:
            hi = mid
        else:
            lo = mid
    return gen(lo)


# ------------------------------------------------------------------------------------ LP tools
class Box:
    """the convex set { f : sum_k w_k delta_k(f) <= 1, f[0] = 0 } as an LP feasible region
    (variables f in R^N and t in R^n with f_x - f_y <= t_k for all pairs differing only at k)."""

    def __init__(self, model, w):
        N, n = model.N, model.n
        rows, cols, vals = [], [], []
        r = 0
        self.diff = []
        for k in range(n):
            xs, ys = model.pairs(k)
            m = len(xs)
            rr = np.arange(r, r + m)
            rows += [rr, rr, rr]
            cols += [xs, ys, np.full(m, N + k)]
            vals += [np.ones(m), -np.ones(m), -np.ones(m)]
            r += m
            self.diff.append((xs, ys))
        rows.append(np.full(n, r))
        cols.append(N + np.arange(n))
        vals.append(np.asarray(w, dtype=float))
        self.A = coo_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(r + 1, N + n)).tocsr()
        self.b = np.zeros(r + 1)
        self.b[-1] = 1.0
        self.bounds = [(0, 0)] + [(None, None)] * (N - 1) + [(0, None)] * n
        self.N, self.n = N, n

    def maximize(self, obj):
        scale = np.abs(obj).max()                   # HiGHS fails on badly scaled costs: normalise
        if scale == 0:
            return 0.0, np.zeros(self.N)
        c = -np.concatenate([obj / scale, np.zeros(self.n)])
        for method in ("highs", "highs-ipm"):
            res = linprog(c, A_ub=self.A, b_ub=self.b, bounds=self.bounds, method=method)
            if res.status == 0:
                break
        assert res.status == 0, res.message
        return -res.fun * scale, res.x[:self.N]


def sum_of_max(box, terms, starts, iters=25):
    """local search for sup { sum_j a_j max(L_j f) : f in box }; terms = [(a_j, L_j)]"""
    best, fbest = -1.0, None
    for f in starts:
        val = -1.0
        for _ in range(iters):
            obj = np.zeros(box.N)
            for a, L in terms:
                obj += a * L[np.argmax(L @ f)]
            _, fnew = box.maximize(obj)
            valnew = sum(a * (L @ fnew).max() for a, L in terms)
            if valnew <= val + 1e-11:
                break
            f, val = fnew, valnew
        if val > best:
            best, fbest = val, f
    return best, fbest


def test_functions(rng, m, count):
    fs = []
    shape = m.shape
    for i in range(count):
        t = i % 6
        if t == 0:
            f = rng.standard_normal(shape)
        elif t == 1:
            f = (rng.random(shape) < rng.uniform(0.1, 0.9)).astype(float)
        elif t == 2:
            f = rng.standard_normal(shape) ** 3
        elif t == 3:                                    # function of one or two coordinates
            f = np.zeros(shape)
            for k in rng.choice(m.n, size=int(rng.integers(1, 3)), replace=False):
                v = rng.standard_normal(shape[k])
                f = f + np.moveaxis(np.broadcast_to(v, shape[:k] + shape[k + 1:] + (shape[k],)), -1, k)
        elif t == 4:
            f = np.log(m.p) * rng.choice([-1, 1])
        else:
            f = m.p / m.p.max() + 0.1 * rng.standard_normal(shape)
        fs.append(f)
    return fs


# ------------------------------------------------------------------------------------ the checks
class Stats:
    def __init__(self):
        self.max = {}
        self.viol = {}
        self.count = {}

    def rec(self, name, lhs, rhs, tol=TOL):
        """lhs <= rhs claimed"""
        self.count[name] = self.count.get(name, 0) + 1
        if lhs > rhs + tol * (1 + abs(rhs)):
            self.viol[name] = self.viol.get(name, 0) + 1
        if rhs > 1e-9:
            self.max[name] = max(self.max.get(name, 0.0), lhs / rhs)

    def report(self, label):
        print("-- " + label)
        for name in sorted(self.count):
            print("   %-66s tests %7d  violations %d  tightest lhs/rhs %.9f" % (
                name, self.count[name], self.viol.get(name, 0), self.max.get(name, float("nan"))))
        return sum(self.viol.values())


def majorant(m, order, w):
    """A_n ... A_1 applied to all unit vectors; returns matrix X with columns x^(n) for e_j"""
    n = m.n
    X = np.eye(n)
    for l in order:
        Y = X.copy()
        Y[l, :] = 0.0
        for k in range(n):
            if k != l:
                Y[k, :] = X[k, :] + m.c[l, k] * X[l, :]
        X = Y
    return X


def check_basic(m, rng, st, fs):
    one = np.ones(m.shape)
    for l in range(m.n):
        assert np.abs(m.Pi(l, one) - 1).max() < 1e-13                                  # Pi_l 1 = 1
        assert np.abs(m.cond[l].sum(axis=l) - 1).max() < 1e-13                         # rho_l is a probability density
        for f in fs[:6]:
            g = m.Pi(l, f)
            st.rec("(K1) delta_l(Pi_l f) = 0", m.delta(g)[l], 0.0, 1e-13)
            st.rec("(K1) sup Pi_l f <= sup f", g.max(), f.max(), 1e-13)
            st.rec("(K1) inf f <= inf Pi_l f", f.min(), g.min(), 1e-13)
            st.rec("(K2) |pi(Pi_l f) - pi(f)| = 0", abs(m.mean(g) - m.mean(f)), 0.0, 1e-13)


def check_c2(m, st, fs):
    for f in fs:
        d = m.delta(f)
        for l in range(m.n):
            dg = m.delta(m.Pi(l, f))
            for k in range(m.n):
                if k != l:
                    st.rec("C.2 delta_k(Pi_l f) <= delta_k(f) + c_lk delta_l(f)", dg[k], d[k] + m.c[l, k] * d[l])


def check_c2_lp(m, rng, st, nsample=40):
    """exact supremum over f of [(Pi_l f)(U) - (Pi_l f)(U')] / [delta_k(f) + c_lk delta_l(f)] for a pair U, U'
    differing only at k: an LP in the 2 q_l values g[i, V] = f(U^{l->V}), f(U'^{l->V})."""
    n = m.n
    for _ in range(nsample):
        l, k = rng.choice(n, size=2, replace=False)
        q = m.shape[l]
        arr = np.moveaxis(m.cond[l], (k, l), (-2, -1)).reshape(-1, m.shape[k], q)
        rest = int(rng.integers(arr.shape[0]))
        i, j = rng.choice(m.shape[k], size=2, replace=False)
        r0, r1 = arr[rest, i], arr[rest, j]
        c = m.c[l, k]
        # variables g0 (q), g1 (q), a, b ; maximise r0.g0 - r1.g1 ; a + c b <= 1
        nv = 2 * q + 2
        A, bub = [], []
        for V in range(q):
            for sgn in (1, -1):
                row = np.zeros(nv)
                row[V], row[q + V], row[2 * q] = sgn, -sgn, -1
                A.append(row)
                bub.append(0)
            for V2 in range(q):
                if V2 != V:
                    for off in (0, q):
                        row = np.zeros(nv)
                        row[off + V], row[off + V2], row[2 * q + 1] = 1, -1, -1
                        A.append(row)
                        bub.append(0)
        row = np.zeros(nv)
        row[2 * q], row[2 * q + 1] = 1, c
        A.append(row)
        bub.append(1)
        obj = np.concatenate([r0, -r1, [0, 0]])
        bounds = [(0, 0)] + [(None, None)] * (2 * q - 1) + [(0, None)] * 2
        res = linprog(-obj, A_ub=np.array(A), b_ub=np.array(bub), bounds=bounds, method="highs")
        assert res.status == 0
        st.rec("C.2 exact sup over f (LP), one pair U,U'", -res.fun, 1.0, 1e-9)


def check_c3(m, rng, st, fs, w, lam, tag):
    n = m.n
    # hypothesis (4.1)
    assert np.all(m.c @ w <= lam * w + 1e-12), "(4.1) fails for the chosen weights"
    assert 0 <= lam <= 1 + 1e-12
    for f in fs:
        d = m.delta(f)
        Wf = w @ d
        for l in range(n):
            st.rec("C.3a %s" % tag, w @ m.delta(m.Pi(l, f)), Wf - (1 - lam) * w[l] * d[l])
        # (b): random sequence of links
        seq = rng.integers(0, n, size=120)
        g, tot = f, 0.0
        for l in seq:
            tot += w[l] * m.delta(g)[l]
            g = m.Pi(l, g)
        st.rec("C.3b %s" % tag, (1 - lam) * tot, Wf)
        # (c): a round in random order; componentwise majorant along the way
        order = rng.permutation(n)
        g = f
        x = d.copy()
        for l in order:
            y = x + m.c[l] * x[l]
            y[l] = 0.0
            g = m.Pi(l, g)
            dg = m.delta(g)
            st.rec("C.3c componentwise delta(f_i) <= A_i..A_1 delta(f)", (dg - y).max(), 0.0, 1e-11)
            x = y
        st.rec("C.3c W(Sf) <= lambda W(f) %s" % tag, w @ m.delta(g), lam * Wf)
    for _ in range(6):
        order = rng.permutation(n)
        X = majorant(m, order, w)
        for j in range(n):
            st.rec("C.3c majorant w.(A_n..A_1 e_j) <= lambda w_j %s" % tag, w @ X[:, j], lam * w[j])
            # the three cases of the proof, one step at a time
            x = np.zeros(n)
            x[j] = 1.0
            seen = False
            for l in order:
                y = x + m.c[l] * x[l]
                y[l] = 0.0
                if l == j:
                    seen = True
                    assert np.array_equal(y, m.c[j])                       # i = i0: x = (c_jk)_k
                    st.rec("C.3c case i = i0: sum_k c_jk w_k <= lambda w_j %s" % tag, w @ y, lam * w[j])
                elif not seen:
                    assert np.array_equal(y, x)                            # i < i0: nothing changes
                else:
                    st.rec("C.3c case i > i0: w.(A_i x) <= w.x %s" % tag, w @ y, w @ x)
                x = y
            assert np.allclose(x, X[:, j])


def check_c3_lp(m, rng, st, w, lam, tag, nstart=3):
    """LP local search for the worst f in C.3(a) and C.3(c) (needs all w_k > 0)"""
    box = Box(m, w)
    n, N = m.n, m.N
    D = []
    for k in range(n):
        xs, ys = box.diff[k]
        Dk = np.zeros((len(xs), N))
        Dk[np.arange(len(xs)), xs] = 1
        Dk[np.arange(len(xs)), ys] -= 1
        D.append(Dk)
    P = [m.Pi_matrix(l) for l in range(n)]
    starts = [rng.standard_normal(N) for _ in range(nstart)]
    # (a) for one random l: W(Pi_l f) + (1-lam) w_l delta_l(f) <= W(f)
    l = int(rng.integers(n))
    terms = [(w[k], D[k] @ P[l]) for k in range(n) if k != l] + [((1 - lam) * w[l], D[l])]
    val, f = sum_of_max(box, terms, starts)
    fa = f.reshape(m.shape)
    st.rec("C.3a LP search %s" % tag, w @ m.delta(m.Pi(l, fa)) + (1 - lam) * w[l] * m.delta(fa)[l], w @ m.delta(fa))
    # (c) for one random order
    order = rng.permutation(n)
    S = np.eye(N)
    for l in order:
        S = P[l] @ S
    terms = [(w[k], D[k] @ S) for k in range(n)]
    val, f = sum_of_max(box, terms, starts)
    fa = f.reshape(m.shape)
    g = fa
    for l in order:
        g = m.Pi(l, g)
    st.rec("C.3c LP search W(Sf) <= lambda W(f) %s" % tag, w @ m.delta(g), lam * (w @ m.delta(fa)))
    return S


def check_c4(m, rng, st, fs, lp=True):
    n, N = m.n, m.N
    a = m.alpha
    assert a < 1
    order = rng.permutation(n)
    for f in fs:
        D = m.delta(f).sum()
        st.rec("C.4 osc(f) <= Delta(f)", f.max() - f.min(), D)
        mean = m.mean(f)
        g = f
        for it in range(0, 8):
            st.rec("C.4 ||S^n f - pi f|| <= alpha^n Delta(f), n=%d" % it, np.abs(g - mean).max(), a ** it * D)
            for l in order:
                g = m.Pi(l, g)
    if lp and N <= 128:
        box = Box(m, np.ones(n))
        P = [m.Pi_matrix(l) for l in range(n)]
        S = np.eye(N)
        for l in order:
            S = P[l] @ S
        Sn = np.eye(N)
        for it in range(0, 4):
            worst = 0.0
            for U0 in rng.choice(N, size=min(N, 10), replace=False):
                v, _ = box.maximize(Sn[U0] - m.p.ravel())
                worst = max(worst, v)
            st.rec("C.4 exact sup over f (LP), n=%d" % it, worst, a ** it)
            Sn = S @ Sn


def families(rng):
    yield "dense 2^5", gen_dense(rng, (2,) * 5)
    yield "dense 2^6", gen_dense(rng, (2,) * 6)
    yield "dense 3^4", gen_dense(rng, (3,) * 4)
    yield "dense mixed (2,3,2,3,2)", gen_dense(rng, (2, 3, 2, 3, 2))
    yield "ising n=6", gen_ising(rng, 6)
    yield "ising n=7", gen_ising(rng, 7)
    yield "ising n=8", gen_ising(rng, 8)
    yield "potts q=3 n=4", gen_potts(rng, 4)
    yield "potts q=3 n=5", gen_potts(rng, 5)
    yield "gauge n=6", gen_gauge(rng, 6, 5)
    yield "gauge n=7", gen_gauge(rng, 7, 6)
    yield "gauge n=8", gen_gauge(rng, 8, 7)


def main():
    rng = np.random.default_rng(20261115)
    total_viol = 0
    nmodels = 0

    # ---- part 1: w = 1, lambda = alpha_pi (the setting of Lemma C.4) -------------------------
    st = Stats()
    for rep in range(3):
        for name, gen in families(rng):
            for target in (0.35, 0.8, 0.98):
                m = tune(gen, lambda mm: mm.alpha, target)
                nmodels += 1
                fs = test_functions(rng, m, 12)
                check_basic(m, rng, st, fs)
                check_c2(m, st, fs)
                check_c2_lp(m, rng, st, nsample=12)
                check_c3(m, rng, st, fs, np.ones(m.n), m.alpha, "[w=1, lam=alpha]")
                check_c4(m, rng, st, fs, lp=(rep == 0))
                if rep == 0 and m.N <= 128:
                    check_c3_lp(m, rng, st, np.ones(m.n), m.alpha, "[w=1, lam=alpha]", nstart=2)
    total_viol += st.report("part 1: %d models tuned to alpha_pi in {0.35, 0.8, 0.98}; weights w = 1" % nmodels)

    # ---- part 2: Perron weights, lambda = spectral radius of c (sharpest form of (4.1)) --------
    st = Stats()
    nm = 0
    rowsum_gt1 = 0
    for rep in range(3):
        for name, gen in families(rng):
            for target in (0.6, 0.95, 1.0):
                m = tune(gen, lambda mm: mm.r, target)
                w = m.perron
                if w.min() < 1e-6:
                    continue                                    # c reducible: skip (zero weights are part 3)
                lam = float((m.c @ w / w).max())
                if lam > 1:
                    lam = 1.0 if lam < 1 + 1e-9 else lam
                if lam > 1:
                    continue
                nm += 1
                rowsum_gt1 += m.alpha > 1
                fs = test_functions(rng, m, 12)
                check_c3(m, rng, st, fs, w, lam, "[Perron w, lam=r]")
                if rep == 0 and m.N <= 128:
                    check_c3_lp(m, rng, st, w, lam, "[Perron w, lam=r]", nstart=2)
    total_viol += st.report("part 2: %d models tuned to spectral radius r in {0.6, 0.95, 1.0}; Perron weights "
                            "(%d of them have alpha_pi > 1, so w = 1 would not be allowed)" % (nm, rowsum_gt1))

    # ---- part 3: weights with zeros (two independent blocks; w = 0 on the second block) ---------
    st = Stats()
    nm = 0
    for rep in range(12):
        g1 = gen_ising(rng, 4) if rep % 2 else gen_dense(rng, (2, 3, 2))
        g2 = gen_dense(rng, (2, 2)) if rep % 3 else gen_ising(rng, 3)
        m1 = tune(g1, lambda mm: mm.r, 0.9)
        m2 = g2(2.5)                                 # strongly coupled second block
        p = np.multiply.outer(m1.p, m2.p)
        m = Model(p)
        w = np.concatenate([m1.perron, np.zeros(m2.n)])
        lam = float(np.max((m1.c @ m1.perron) / m1.perron))
        assert np.abs(m.c[:m1.n, m1.n:]).max() < 1e-12 and np.abs(m.c[m1.n:, :m1.n]).max() < 1e-12
        fs = test_functions(rng, m, 12)
        check_c3(m, rng, st, fs, w, lam, "[zero weights]")
        nm += 1
    total_viol += st.report("part 3: %d product models, weights zero on a strongly coupled independent block" % nm)
    print("   (alpha_pi of the last product model: %.3f; row sums of c on the zero-weight block: %s)" % (
        m.alpha, np.round(m.c[m1.n:].sum(axis=1), 3)))

    # ---- part 4: is lambda <= 1 really needed in C.3(c)?  (not a claim of the document) ---------
    print("-- part 4: lambda > 1 (outside the hypothesis of C.3): does the conclusion of (c) survive?")
    worst_major, worst_true = 0.0, 0.0
    for rep in range(6):
        gen = gen_ising(rng, 6) if rep % 2 else gen_gauge(rng, 6, 6)
        m = tune(gen, lambda mm: mm.r, 2.0)
        w = m.perron
        if w.min() < 1e-6:
            continue
        lam = float((m.c @ w / w).max())
        if lam <= 1.5:
            continue                                # only models that really violate lambda <= 1
        for _ in range(10):
            order = rng.permutation(m.n)
            X = majorant(m, order, w)
            worst_major = max(worst_major, float(np.max((w @ X) / (lam * w))))
        fs = test_functions(rng, m, 30)
        for f in fs:
            order = rng.permutation(m.n)
            g = f
            for l in order:
                g = m.Pi(l, g)
            worst_true = max(worst_true, (w @ m.delta(g)) / (lam * (w @ m.delta(f))))
    print("   models with r about 2: max  w.(A_n..A_1 e_j)/(lambda w_j) = %.4f  (> 1: the majorant argument needs lambda <= 1)" % worst_major)
    print("   same models: max over random f of W(Sf)/(lambda W(f)) = %.4f  (> 1: the conclusion of (c) itself fails for lambda > 1,"
          " so the hypothesis lambda <= 1 is necessary)" % worst_true)

    print("TOTAL VIOLATIONS: %d" % total_viol)
    return total_viol


if __name__ == "__main__":
    sys.exit(1 if main() else 0)
