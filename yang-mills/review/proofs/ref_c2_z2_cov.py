#!/usr/bin/env python3
"""Referee C2 -- BEWIJZEN.md Stelling C, point 1 (and Propositie C.6 as it is applied there),
in the Z2 laboratory on the 3 x 3 torus in D = 2 (18 links, all 2^18 configurations summed).

G = Z2, weight exp(beta * sum_p sigma_p).  For disjoint link sets A, B, f on A, g on B:

   |mu(fg) - mu(f)mu(g)|  <=  C_theta (osc(g)/2) sum_{k in A} e^{-theta d(k,B)} delta_k(f)     (I)
                          <=  C_theta (osc(g)/2) Delta(f) e^{-theta d(A,B)}                     (II)

with alpha = 6 tanh(beta), 0 < theta < ln(1/alpha), C_theta = e^theta / (1 - alpha e^theta).

Checked:
  0. exact Dobrushin coefficients of the Z2 model versus Lemma C.5 (as used: sum <= alpha);
  1. the covariance identity of the proof (conditioning on the links in B, arbitrary constant c);
  2. inequality (I), (II) for structured and random A, B, f, g and several beta, theta;
  3. sup_{omega,omega'} |mu^omega(f) - mu^omega'(f)| against the bound of Propositie C.6.

Run:  python3 review/proofs/ref_c2_z2_cov.py      (from yang-mills/; about 30 s)
"""
import math

import numpy as np

from ref_c2_geometry import Torus

lat = Torus((3, 3))
NL = lat.nl
SHAPE = (2,) * NL
SIGN = []
for e in range(NL):
    sh = [1] * NL
    sh[e] = 2
    SIGN.append(np.array([1.0, -1.0]).reshape(sh))
PLAQ = np.zeros(SHAPE)
for p in lat.plaq:
    PLAQ = PLAQ + SIGN[p[0]] * SIGN[p[1]] * SIGN[p[2]] * SIGN[p[3]]


def L(x, y, mu):
    return lat.link((x % 3, y % 3), mu)


def shape_on(S):
    return tuple(2 if e in S else 1 for e in range(NL))


def delta(f, k):
    return float(np.abs(f - np.flip(f, axis=k)).max()) if f.shape[k] == 2 else 0.0


def osc(g):
    return float(g.max() - g.min())


class Model:
    def __init__(self, beta):
        self.beta = beta
        self.W = np.exp(beta * PLAQ)
        self.Z = float(self.W.sum())
        self.alpha = 6 * math.tanh(beta)

    def marg(self, S):
        other = tuple(e for e in range(NL) if e not in S)
        return self.W.sum(axis=other, keepdims=True) / self.Z

    def cov(self, A, B, f, g):
        m = self.marg(set(A) | set(B))
        ef, eg, efg = float((m * f).sum()), float((m * g).sum()), float((m * f * g).sum())
        return efg - ef * eg, ef, eg, efg

    def cond_means(self, A, B, f):
        """mu^omega(f) for every omega in Z2^B (array of shape shape_on(B)), and mu_B."""
        m = self.marg(set(A) | set(B))
        axA = tuple(A)
        mB = m.sum(axis=axA, keepdims=True)
        return (m * f).sum(axis=axA, keepdims=True) / mB, mB


def ratio(cov, b):
    """|cov| / bound, with the trivial case bound = 0 (f or g constant) handled: then cov must be 0."""
    if b == 0.0:
        assert abs(cov) < 1e-12, (cov, b)      # rounding only
        return 0.0
    return abs(cov) / b


def bounds(model, A, B, f, g, theta):
    dB = lat.bfs(list(B))
    Cth = math.exp(theta) / (1 - model.alpha * math.exp(theta))
    dk = {k: delta(f, k) for k in A}
    b1 = Cth * 0.5 * osc(g) * sum(math.exp(-theta * dB[k]) * dk[k] for k in A)
    dAB = min(int(dB[k]) for k in A)
    b2 = Cth * 0.5 * osc(g) * sum(dk.values()) * math.exp(-theta * dAB)
    return b1, b2, dAB


def part0():
    print("=== 0. exact Z2 Dobrushin coefficients on the 3 x 3 torus versus Lemma C.5 ===")
    for beta in (0.02, 0.1, 0.168, 0.5, 2.0):
        W = np.exp(beta * PLAQ)
        worst_sum, worst_c, nonnb = 0.0, 0.0, 0.0
        for l in (0, 1):                       # by translation invariance one link per direction suffices
            rho_plus = np.take(W, [0], axis=l) / W.sum(axis=l, keepdims=True)   # P(U_l = +1 | rest)
            s = 0.0
            for k in range(NL):
                if k == l:
                    continue
                c = float(np.abs(rho_plus - np.flip(rho_plus, axis=k)).max())    # TV on a two-point space
                s += c
                if k in lat.nbr[l]:
                    worst_c = max(worst_c, c)
                else:
                    nonnb = max(nonnb, c)
            worst_sum = max(worst_sum, s)
        print(f"  beta={beta:5.3f}: max c_lk (neighbours) = {worst_c:.6f}  [(1/2) tanh(2 beta) = {0.5*math.tanh(2*beta):.6f}, "
              f"Lemma C.5 bound tanh(beta) = {math.tanh(beta):.6f}];  max c_lk (non-neighbours) = {nonnb:.1e};  "
              f"max_l sum_k c_lk = {worst_sum:.6f} <= alpha = {6*math.tanh(beta):.6f}: {worst_sum <= 6*math.tanh(beta) + 1e-12}")


def structured_cases():
    cases = []
    # 1. three links of the plaquette at (0,0) versus the fourth: cov = <sigma_p>
    A = [L(0, 0, 0), L(1, 0, 1), L(0, 1, 0)]
    B = [L(0, 0, 1)]
    cases.append(("3 links of a plaquette | 4th link (cov = <sigma_p>)", A, B,
                  SIGN[A[0]] * SIGN[A[1]] * SIGN[A[2]], SIGN[B[0]]))
    # 2. the 1 x 2 rectangle with corners (0,0),(2,0),(2,1),(0,1), cut through the two long sides
    A = [L(0, 0, 0), L(0, 0, 1), L(0, 1, 0)]
    B = [L(1, 0, 0), L(2, 0, 1), L(1, 1, 0)]
    cases.append(("two halves of a 1x2 Wilson loop (cov = <W_1x2>)", A, B,
                  SIGN[A[0]] * SIGN[A[1]] * SIGN[A[2]], SIGN[B[0]] * SIGN[B[1]] * SIGN[B[2]]))
    # 3. two plaquettes sharing only a corner
    A = list(lat.plaq[lat.plaq_label.index(((0, 0), 0, 1))])
    B = list(lat.plaq[lat.plaq_label.index(((1, 1), 0, 1))])
    fa = SIGN[A[0]] * SIGN[A[1]] * SIGN[A[2]] * SIGN[A[3]]
    gb = SIGN[B[0]] * SIGN[B[1]] * SIGN[B[2]] * SIGN[B[3]]
    cases.append(("plaquette (0,0) | plaquette (1,1)", A, B, fa, gb))
    # 4. the two "time layers": holonomies of row 0 and row 1 (direction 0 links at y = 0 and y = 1)
    A = [L(x, 0, 0) for x in range(3)]
    B = [L(x, 1, 0) for x in range(3)]
    cases.append(("holonomy of row 0 | holonomy of row 1 (torelon correlator, t=1)", A, B,
                  SIGN[A[0]] * SIGN[A[1]] * SIGN[A[2]], SIGN[B[0]] * SIGN[B[1]] * SIGN[B[2]]))
    # 5. one row against everything else that is not a neighbour-free complement: A = row 0, B = all other links
    B = [e for e in range(NL) if e not in A]
    g = np.ones(shape_on(B))
    for x in range(3):
        g = g * SIGN[L(x, 1, 0)]
    cases.append(("row 0 holonomy | function of ALL other links (row 1 holonomy)", A, B,
                  SIGN[A[0]] * SIGN[A[1]] * SIGN[A[2]], g))
    return cases


def part12():
    print("\n=== 1./2. covariance identity and inequalities (I), (II) ===")
    rng = np.random.default_rng(20261115)
    worst1 = 0.0
    worst_id = 0.0
    for beta in (0.02, 0.05, 0.10, 0.15, 0.165):
        model = Model(beta)
        la = math.log(1 / model.alpha)
        print(f" beta = {beta}: alpha = {model.alpha:.4f}, ln(1/alpha) = {la:.4f}")
        for name, A, B, f, g in structured_cases():
            cov, ef, eg, efg = model.cov(A, B, f, g)
            # identity of the proof: cov = sum_omega mu_B(omega) (g(omega) - c) [mu^omega(f) - mu(f)], any c
            cm, mB = model.cond_means(A, B, f)
            for c in (0.0, 0.5 * (g.max() + g.min()), 3.7):
                rhs = float((mB * (g - c) * (cm - ef)).sum())
                worst_id = max(worst_id, abs(rhs - cov))
            best = (1e99, None)
            for frac in (0.05, 0.3, 0.6, 0.9, 0.99):
                theta = frac * la
                b1, b2, dAB = bounds(model, A, B, f, g, theta)
                assert b1 <= b2 * (1 + 1e-12)
                worst1 = max(worst1, ratio(cov, b1))
                if b1 < best[0]:
                    best = (b1, frac)
            sup = float(cm.max() - cm.min())
            print(f"   {name:66s} d(A,B)={dAB}: cov = {cov:+.6e}; smallest bound (I) over theta = {best[0]:.4e} "
                  f"(theta = {best[1]} ln(1/alpha)); ratio |cov|/bound = {abs(cov)/best[0]:.3e}; "
                  f"sup_w,w' |mu^w(f)-mu^w'(f)| = {sup:.4e}")
        # random sets and functions, plus the 'adversarial' f = sign(E[g|U_A] - mu(g))
        wr, wa, ntr = 0.0, 0.0, 0
        dist_seen, wr_by_d = {}, {}
        for trial in range(120):
            perm = rng.permutation(NL)
            na, nb = rng.integers(1, 5), rng.integers(1, 5)
            A, B = sorted(perm[:na].tolist()), sorted(perm[na:na + nb].tolist())
            f = rng.uniform(-1, 1, size=shape_on(A))
            g = rng.uniform(-1, 1, size=shape_on(B)) if trial % 2 else np.sign(rng.uniform(-1, 1, size=shape_on(B)))
            cov, ef, eg, efg = model.cov(A, B, f, g)
            m = model.marg(set(A) | set(B))
            mA = m.sum(axis=tuple(B), keepdims=True)
            cg = (m * g).sum(axis=tuple(B), keepdims=True) / mA          # E[g | U_A]
            fadv = np.sign(cg - eg)
            fadv[fadv == 0] = 1.0
            cova = model.cov(A, B, fadv, g)[0]
            for frac in (0.05, 0.3, 0.6, 0.9, 0.99):
                theta = frac * la
                b1, b2, dAB = bounds(model, A, B, f, g, theta)
                wr = max(wr, ratio(cov, b1))
                wr_by_d[dAB] = max(wr_by_d.get(dAB, 0.0), ratio(cov, b1))
                if osc(fadv) > 0:
                    b1a, _, _ = bounds(model, A, B, fadv, g, theta)
                    wa = max(wa, ratio(cova, b1a))
            ntr += 1
        worst1 = max(worst1, wr, wa)
        byd = ", ".join(f"d={d}: {v:.2e}" for d, v in sorted(wr_by_d.items()))
        print(f"   {ntr} random (A,B,f,g): max |cov|/bound(I) = {wr:.3e} (by d(A,B): {byd});  with f = sign(E[g|U_A]-mu(g)): {wa:.3e}")
    print(f" identity of the proof (any c): max abs error = {worst_id:.1e}")
    print(f" largest |cov| / bound (I) over everything = {worst1:.3e}  ->  violation: {worst1 > 1}")


def part3():
    print("\n=== 3. Propositie C.6 as applied in points 1 and 3: f = u_k (and a random f on k and two neighbours),")
    print("       B = all links at link distance > rho from k, i.e. d(k,B) = rho + 1 ===")
    rng = np.random.default_rng(7)
    worst = 0.0
    k = L(0, 0, 0)
    dk = lat.bfs([k])
    print(f"  links at distance 0,1,2,3 from k on the 3 x 3 torus: {[int((dk == d).sum()) for d in range(4)]}")
    for beta in (0.02, 0.05, 0.10, 0.15):
        model = Model(beta)
        la = math.log(1 / model.alpha)
        for rho in (0, 1):
            B = [e for e in range(NL) if dk[e] > rho]
            dB = lat.bfs(B)
            assert dB[k] == rho + 1
            nb = sorted(lat.nbr[k])[:2] if rho >= 1 else []
            for kind, A, f in (("f = u_k", [k], SIGN[k]),
                               ("random f on k + 2 nbrs", [k] + nb, rng.uniform(-1, 1, size=shape_on([k] + nb)))):
                if kind.startswith("random") and rho == 0:
                    continue
                cm, mB = model.cond_means(A, B, f)
                sup = float(cm.max() - cm.min())
                best = min((math.exp(fr * la) / (1 - model.alpha * math.exp(fr * la))) *
                           sum(math.exp(-fr * la * dB[a]) * delta(f, a) for a in A) for fr in (0.05, 0.2, 0.4, 0.6, 0.8, 0.95))
                worst = max(worst, sup / best)
                print(f"  beta={beta:4.2f} rho={rho} |B|={len(B):2d} {kind:22s}: sup_w,w' |mu^w(f)-mu^w'(f)| = {sup:.4e}, "
                      f"best C.6 bound over theta = {best:.4e}, ratio = {sup/best:.3e}")
    print(f" largest ratio = {worst:.3e}  ->  violation: {worst > 1}")


if __name__ == "__main__":
    part0()
    part12()
    part3()
