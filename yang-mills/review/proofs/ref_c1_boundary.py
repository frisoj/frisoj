#!/usr/bin/env python3
"""Referee C1 -- BEWIJZEN.md sections 4.3 and 4.4 (Lemma C.5, Propositie C.6) by brute force.

Part A  ABSTRACT version of Propositie C.6 with the EXACT Dobrushin constant.
        Sites = R u B with a local interaction (pairs or 'plaquettes'); two sites are neighbours
        if they share an interaction term; d = graph distance.  For every boundary condition
        omega the conditional measure mu^omega on R is computed exactly, with its exact
        coefficients c^omega_lk, and
            alpha* = max_omega max_l sum_k c^omega_lk          (tuned to 0.5 and 0.9).
        The proof of C.6 uses nothing else, so it must give, for every 0 < theta < ln(1/alpha*),
            |mu^omega(f) - mu^omega'(f)| <= e^theta/(1 - alpha* e^theta) sum_k e^{-theta d(k,B)} delta_k(f).
        Checked: step 1 ((4.1) for the exponential weights), step 2 (Pi^omega_l = Pi^omega'_l off
        the boundary layer, (4.2) on it), step 3 (the telescoping identity that mixes mu^omega' with
        the dynamics of omega, and the chain of inequalities), and the final bound through the
        EXACT supremum over all f (a linear programme).  This is a sharper test than the statement
        in the document, which uses the upper bound alpha = 6(D-1) tanh(beta) >= alpha*.

Part B  The statement as written, for the gauge group Z2 = centre of SU(2) (weight
        exp(beta sum_p sigma_p), the SU(2) weight restricted to U = +-1) on periodic lattices that
        satisfy the hypotheses: D = 2 (3 x 3, 18 links) and D = 3 (3 x 3 x 3, R = the 12 links of a cube).
        Checked: the disintegration formula of 4.3, Lemma C.5 (c^omega_lk <= tanh(beta n_lk), row sums
        <= 6(D-1) tanh(beta), c = 0 for non-neighbours), and Propositie C.6 with alpha = 6(D-1) tanh(beta).

Run:  python3 review/proofs/ref_c1_boundary.py      (from yang-mills/; about 80 s)
"""
import itertools
import os
import sys
from collections import deque

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ref_c1_framework import Box, Model, test_functions  # noqa: E402
from ref_c1_lattice import build  # noqa: E402

VIOL = []


def claim(name, lhs, rhs, tol=1e-9):
    if lhs > rhs + tol * (1 + abs(rhs)):
        VIOL.append((name, lhs, rhs))


def bfs(adj, sources, n):
    d = np.full(n, np.inf)
    q = deque()
    for s in sources:
        d[s] = 0
        q.append(s)
    while q:
        a = q.popleft()
        for b in adj[a]:
            if d[b] == np.inf:
                d[b] = d[a] + 1
                q.append(b)
    return d


# ------------------------------------------------------------------------------- part A: models
def spin_arrays(shape):
    return [g for g in np.indices(shape)]


def energy(rng, shape, terms, kind, B=(), bmult=1.0):
    """terms: list of tuples of sites.  kind 'pm': product of +-1 spins; 'potts': all equal.
    Terms that contain a site of B are multiplied by bmult (strong coupling to the boundary)."""
    s = spin_arrays(shape)
    E = np.zeros(shape)
    for t in terms:
        J = rng.uniform(0.4, 1.0) * rng.choice([-1, 1])
        if any(i in B for i in t):
            J *= bmult
        if kind == "pm":
            term = np.ones(shape)
            for i in t:
                term = term * (2.0 * s[i] - 1)
        else:
            term = np.ones(shape)
            for i in t[1:]:
                term = term * (s[i] == s[t[0]])
        E += J * term
    for i in range(len(shape)):                    # small single-site fields
        E += 0.2 * rng.standard_normal(shape[i])[s[i]]
    return E


def topologies():
    yield "chain 1+7", (2,) * 8, [(i, i + 1) for i in range(7)], [0], "pm"
    yield "ring 1+7", (2,) * 8, [(i, (i + 1) % 8) for i in range(8)], [0], "pm"
    g = lambda x, y: 3 * x + y
    grid = [(g(x, y), g(x + 1, y)) for x in range(2) for y in range(3)] + [(g(x, y), g(x, y + 1)) for x in range(3) for y in range(2)]
    yield "grid 3x3, B = corner", (2,) * 9, grid, [0], "pm"
    yield "grid 3x3, B = side", (2,) * 9, grid, [0, 1, 2], "pm"
    yield "complete 1+6", (2,) * 7, [(i, j) for i in range(7) for j in range(i + 1, 7)], [0], "pm"
    # open strip of 3 plaquettes: h[x,0], h[x,1] (x=0..2), v[x] (x=0..3); plaquette x = {h[x,0], v[x+1], h[x,1], v[x]}
    h = lambda x, y: 2 * x + y
    v = lambda x: 6 + x
    yield "plaquette strip 3x1, B = end link", (2,) * 10, [(h(x, 0), v(x + 1), h(x, 1), v(x)) for x in range(3)], [v(0)], "pm"
    # 2 x 2 patch of plaquettes, 12 links, B = 4 links at one corner
    H = lambda x, y: 3 * x + y            # x=0..1, y=0..2
    V = lambda x, y: 6 + 2 * x + y        # x=0..2, y=0..1
    patch = [(H(x, y), V(x + 1, y), H(x, y + 1), V(x, y)) for x in range(2) for y in range(2)]
    yield "plaquette patch 2x2, B = 3 links", (2,) * 12, patch, [V(0, 0), V(0, 1), H(0, 0)], "pm"
    yield "potts q=3 chain 1+5", (3,) * 6, [(i, i + 1) for i in range(5)], [0], "potts"
    yield "potts q=3 triangle strip 2+4", (3,) * 6, [(0, 1, 2), (1, 2, 3), (2, 3, 4), (3, 4, 5)], [0, 1], "potts"
    # links at infinite distance from B (weight 0): a chain plus a detached coupled triangle
    yield "chain 1+4 and detached triangle (d = inf)", (2,) * 8, [(i, i + 1) for i in range(4)] + [(5, 6), (6, 7), (5, 7)], [0], "pm"


def strong_boundary_topologies():
    """the coupling to B is 40 times the coupling inside R: step 2 of the proof (d_TV <= 1) becomes sharp"""
    yield "chain 1+4, strong boundary", (2,) * 5, [(i, i + 1) for i in range(4)], [0], "pm"
    yield "B joined to 2 sites of a ring of 5", (2,) * 6, [(0, 1), (0, 3)] + [(i, i % 5 + 1) for i in range(1, 6)], [0], "pm"
    yield "two boundary sites, R = 2 x 2 grid", (2,) * 6, [(0, 2), (1, 5), (2, 3), (4, 5), (2, 4), (3, 5)], [0, 1], "pm"
    yield "plaquette strip 3x1, strong boundary", (2,) * 10, [(2 * x, 7 + x, 2 * x + 1, 6 + x) for x in range(3)], [6], "pm"


def cond_models(E, eps, B):
    p = np.exp(eps * (E - E.max()))
    pm = np.moveaxis(p, B, list(range(len(B))))
    out = {}
    for om in itertools.product(*[range(E.shape[b]) for b in B]):
        out[om] = Model(pm[om])
    return out


def tune_eps(E, B, target):
    lo, hi = 0.0, 0.05
    def astar(e):
        try:
            return max(m.alpha for m in cond_models(E, e, B).values())
        except AssertionError:                      # density underflows to 0: treat as "too strong"
            return np.inf
    for _ in range(9):
        if astar(hi) > target:
            break
        lo, hi = hi, 2 * hi
    for _ in range(26):
        mid = 0.5 * (lo + hi)
        if astar(mid) > target:
            hi = mid
        else:
            lo = mid
    return lo


def proof_steps(models, om, om2, w, lam, theta, bdry, f, rounds, tag):
    """step 2 and step 3 of the proof of C.6 for one pair of boundary conditions and one f.
    Returns (|mu^om'(f) - mu^om(f)|, sum over boundary-layer steps of delta, bound)."""
    m, m2 = models[om], models[om2]
    n = m.n
    g = f
    tele = 0.0
    bsum = 0.0
    allsum = 0.0
    for r in range(rounds):
        for l in range(n):
            d = m.delta(g)[l]
            a, b = m2.Pi(l, g), m.Pi(l, g)
            diff = np.abs(a - b).max()
            if l in bdry:
                claim("(4.2) ||Pi^om_l h - Pi^om'_l h|| <= delta_l(h) " + tag, diff, d)
                bsum += d
            else:
                claim("step 2: Pi^om_l = Pi^om'_l off the boundary layer " + tag, diff, 0.0, 1e-13)
            claim("(K2) for mu^om' " + tag, abs(m2.mean(a) - m2.mean(g)), 0.0, 1e-13)
            tele += m2.mean(a - b)
            allsum += w[l] * d
            g = b
    lhs = m2.mean(f) - m.mean(f)
    # telescoping identity, with the remainder after finitely many rounds written out
    rem = m2.mean(g) - m.mean(f)
    claim("telescoping identity " + tag, abs(lhs - (tele + rem)), 0.0, 1e-12)
    claim("remainder small (uniform convergence, C.4) " + tag, abs(rem), m.alpha ** rounds * m.delta(f).sum())
    W = w @ m.delta(f)
    claim("C.3(b) sum_i w delta <= W/(1-lam) " + tag, allsum, W / (1 - lam))
    claim("boundary sum <= e^theta W/(1-lam) " + tag, bsum, np.exp(theta) * W / (1 - lam))
    claim("|lhs| <= boundary sum + remainder " + tag, abs(lhs), bsum + abs(rem) + 1e-12)
    return abs(lhs), bsum, np.exp(theta) * W / (1 - lam)


def part_a(rng, strong=False):
    if strong:
        print("== Part A2: the same with a strong coupling to the boundary (40 x) and small alpha* ==")
        topo, targets, fracs, bmult = strong_boundary_topologies(), (0.05, 0.3), (0.02, 0.5, 0.9), 40.0
    else:
        print("== Part A: abstract version of C.6 with the exact Dobrushin constant alpha* ==")
        topo, targets, fracs, bmult = topologies(), (0.5, 0.9), (0.1, 0.5, 0.9), 1.0
    print("%-42s %6s %6s  %-26s %s" % ("model", "alpha*", "pairs", "sup_f lhs/rhs (LP) per theta", "max over tested f (incl. LP optimiser)"))
    best_overall = 0.0
    for name, shape, terms, B, kind in topo:
        ntot = len(shape)
        adj = [set() for _ in range(ntot)]
        for t in terms:
            for a in t:
                for b in t:
                    if a != b:
                        adj[a].add(b)
        dist_all = bfs(adj, B, ntot)
        R = [i for i in range(ntot) if i not in B]
        dist = dist_all[R]
        pos = {site: i for i, site in enumerate(R)}
        bdry = {pos[site] for site in R if dist_all[site] == 1}
        E = energy(rng, shape, terms, kind, B, bmult)
        for target in targets:
            eps = tune_eps(E, B, target)
            models = cond_models(E, eps, B)
            astar = max(m.alpha for m in models.values())
            assert 0 < astar < 1
            # c = 0 for non-neighbours (needed in step 1)
            for m in models.values():
                for l in range(m.n):
                    for k in range(m.n):
                        if k != l and R[k] not in adj[R[l]]:
                            claim("c = 0 for non-neighbours", m.c[l, k], 0.0, 1e-13)
            oms = list(models)
            pairs = [(a, b) for a in oms for b in oms if a != b]
            if len(pairs) > 4:
                pairs = [pairs[i] for i in rng.choice(len(pairs), size=4, replace=False)]
            row = []
            rnd_best = 0.0
            for frac in fracs:
                theta = frac * np.log(1 / astar)
                lam = astar * np.exp(theta)
                w = np.exp(-theta * dist)
                C = np.exp(theta) / (1 - lam)
                for m in models.values():                                  # step 1
                    claim("step 1: (4.1) for exponential weights", float((m.c @ w - lam * w).max()), 0.0, 1e-12)
                best = 0.0
                for om, om2 in pairs:
                    m, m2 = models[om], models[om2]
                    box = Box(m, w)
                    val, fstar = box.maximize(m2.p.ravel() - m.p.ravel())   # sup_f [mu^om'(f) - mu^om(f)] / W(f)
                    claim("C.6 exact sup over f (LP) [%s]" % name, val, C)
                    best = max(best, val / C)
                    fs = test_functions(rng, m, 4) + [fstar.reshape(m.shape)]
                    for f in fs[:2] + fs[-1:]:
                        lhs, bsum, bound = proof_steps(models, om, om2, w, lam, theta, bdry, f, 12, "[%s]" % name)
                        claim("C.6 final bound, random f [%s]" % name, lhs, C * (w @ m.delta(f)))
                        if w @ m.delta(f) > 0:
                            rnd_best = max(rnd_best, lhs / (C * (w @ m.delta(f))))
                row.append(best)
                best_overall = max(best_overall, best)
            print("%-42s %6.3f %6d  %-26s %.4f" % (name, astar, len(pairs), "  ".join("%.4f" % b for b in row), rnd_best))
    print("   tightest exact ratio sup_f |mu^om(f) - mu^om'(f)| / rhs over these models: %.4f" % best_overall)


# ------------------------------------------------------------------------------- part B: Z2 gauge theory
def z2_setup(shape):
    nl, plaq = build(shape)
    n = np.zeros((nl, nl), dtype=int)
    adj = [set() for _ in range(nl)]
    for p in plaq:
        for a in p:
            for b in p:
                if a != b:
                    n[a, b] += 1
                    adj[a].add(b)
    return nl, plaq, n, adj


def z2_density(plaq, R, B, omega, beta):
    """unnormalised weight w(U_R, omega) = exp(beta sum_p sigma_p) as an array over {+1,-1}^R
    (index 0 <-> +1, index 1 <-> -1); only plaquettes touching R matter for the conditional law."""
    pos = {l: i for i, l in enumerate(R)}
    omg = dict(zip(B, omega))
    shape = (2,) * len(R)
    s = [1.0 - 2.0 * g for g in np.indices(shape)]
    E = np.zeros(shape)
    for p in plaq:
        term = np.ones(shape)
        for l in p:
            term = term * (s[pos[l]] if l in pos else omg[l])
        E += term
    return np.exp(beta * E)


def part_b(rng):
    print("== Part B: Z2 gauge theory (centre of SU(2)) on periodic lattices, alpha = 6(D-1) tanh(beta) ==")
    # ---- D = 2, 3 x 3 torus -------------------------------------------------------------------
    shape = (3, 3)
    D = 2
    nl, plaq, nmat, adj = z2_setup(shape)
    choices = [("B = one link", [0]),
               ("B = links of one row (dir 0, x1 = 0) + the dir-1 links leaving it", [l for l in range(nl) if (l // D) % 3 == 0]),
               ("B = all links of direction 1", [l for l in range(nl) if l % D == 1]),
               ("B = 10 random links", sorted(rng.choice(nl, size=10, replace=False).tolist()))]
    for beta in (0.05, 0.10, 0.15, 0.165):
        alpha = 6 * (D - 1) * np.tanh(beta)
        print("-- D=2, 3x3, beta = %.3f, alpha = %.4f" % (beta, alpha))
        for label, B in choices:
            R = [l for l in range(nl) if l not in B]
            dist = bfs(adj, B, nl)[R]
            pos = {l: i for i, l in enumerate(R)}
            bdry = {pos[l] for l in R if dist[pos[l]] == 1}
            all_om = list(itertools.product([1.0, -1.0], repeat=len(B)))
            if len(all_om) > 6:
                idx = rng.choice(len(all_om), size=6, replace=False)
                oms = [all_om[i] for i in idx]
            else:
                oms = all_om
            models = {}
            Zom = {}
            for om in oms:
                wgt = z2_density(plaq, R, B, om, beta)
                Zom[om] = wgt.sum()
                models[om] = Model(wgt)
            # Lemma C.5
            cmax_ratio, rowmax = 0.0, 0.0
            for m in models.values():
                for l in range(m.n):
                    for k in range(m.n):
                        if k != l:
                            nlk = nmat[R[l], R[k]]
                            claim("C.5 c <= tanh(beta n_lk)", m.c[l, k], np.tanh(beta * nlk), 1e-12)
                            if nlk:
                                cmax_ratio = max(cmax_ratio, m.c[l, k] / np.tanh(beta * nlk))
                claim("C.5 row sums <= alpha", m.alpha, alpha, 1e-12)
                rowmax = max(rowmax, m.alpha)
            # disintegration formula of 4.3 (all omega needed): only for small B
            if len(all_om) <= 8 and len(R) <= 17:
                Zs = {om: z2_density(plaq, R, B, om, beta) for om in all_om}
                Ztot = sum(a.sum() for a in Zs.values())
                # F = product of the links of plaquette 0 (a function of all links), and a random F
                F_err = 0.0
                for trial in range(2):
                    num_direct, num_dis = 0.0, 0.0
                    for om in all_om:
                        Fom = rng.standard_normal(Zs[om].shape)
                        num_direct += (Fom * Zs[om]).sum()
                        num_dis += (Zs[om].sum() / Ztot) * ((Fom * Zs[om]).sum() / Zs[om].sum())
                    F_err = max(F_err, abs(num_direct / Ztot - num_dis))
                claim("disintegration mu(F) = int mu_B(d om) mu^om(F)", F_err, 0.0, 1e-12)
            # Propositie C.6
            best = 0.0
            for frac in (0.2, 0.6, 0.95):
                theta = frac * np.log(1 / alpha)
                lam = alpha * np.exp(theta)
                w = np.exp(-theta * dist)
                C = np.exp(theta) / (1 - lam)
                for m in models.values():
                    claim("step 1 (gauge): (4.1)", float((m.c @ w - lam * w).max()), 0.0, 1e-12)
                pairs = [(oms[i], oms[j]) for i in range(len(oms)) for j in range(len(oms)) if i < j][:4]
                for om, om2 in pairs:
                    m, m2 = models[om], models[om2]
                    if m.N <= 512:
                        box = Box(m, w)
                        val, fstar = box.maximize(m2.p.ravel() - m.p.ravel())
                        claim("C.6 (gauge) exact sup over f (LP)", val, C)
                        best = max(best, val / C)
                        if frac == 0.6:
                            proof_steps(models, om, om2, w, lam, theta, bdry, fstar.reshape(m.shape), 10, "[gauge]")
                    else:
                        # explicit observables: products of links over small sets T (delta_k = 2 on T)
                        s = [1.0 - 2.0 * g for g in np.indices(m.shape)]
                        sets = [[pos[l] for l in p if l in pos] for p in plaq]
                        sets += [[i] for i in range(m.n)]
                        sets += [sorted(set(sets[a]) ^ set(sets[b])) for a in range(len(plaq)) for b in range(a)]
                        for T in sets:
                            if not T:
                                continue
                            f = np.ones(m.shape)
                            for i in T:
                                f = f * s[i]
                            lhs = abs(m.mean(f) - m2.mean(f))
                            rhs = C * 2 * w[T].sum()
                            claim("C.6 (gauge) products of links", lhs, rhs)
                            best = max(best, lhs / rhs)
            print("   %-66s |R|=%2d  max c/tanh(beta n) %.4f  max row sum/alpha %.4f  C.6 tightest lhs/rhs %.5f" % (
                label, len(R), cmax_ratio, rowmax / alpha, best))
    # ---- D = 3, 3 x 3 x 3 torus, R = the 12 links of the unit cube at the origin ------------------
    shape = (3, 3, 3)
    D = 3
    nl, plaq, nmat, adj = z2_setup(shape)
    sites = list(itertools.product(range(3), repeat=3))
    cube = [x for x in sites if max(x) <= 1]
    R = []
    for x in cube:
        for mu in range(3):
            if x[mu] == 0:
                R.append(sites.index(x) * D + mu)
    B = [l for l in range(nl) if l not in R]
    dist = bfs(adj, B, nl)[R]
    relevant = [p for p in plaq if any(l in R for l in p)]
    for beta in (0.02, 0.05, 0.08):
        alpha = 6 * (D - 1) * np.tanh(beta)
        models = {}
        for trial in range(4):
            om = tuple(rng.choice([1.0, -1.0], size=len(B)))
            models[om] = Model(z2_density(relevant, R, B, om, beta))
        cmax_ratio, rowmax = 0.0, 0.0
        for m in models.values():
            for l in range(m.n):
                for k in range(m.n):
                    if k != l:
                        nlk = nmat[R[l], R[k]]
                        claim("C.5 (D=3) c <= tanh(beta n_lk)", m.c[l, k], np.tanh(beta * nlk), 1e-12)
                        if nlk:
                            cmax_ratio = max(cmax_ratio, m.c[l, k] / np.tanh(beta * nlk))
            claim("C.5 (D=3) row sums <= alpha", m.alpha, alpha, 1e-12)
            rowmax = max(rowmax, m.alpha)
        oms = list(models)
        best = 0.0
        for frac in (0.3, 0.9):
            theta = frac * np.log(1 / alpha)
            lam = alpha * np.exp(theta)
            w = np.exp(-theta * dist)
            C = np.exp(theta) / (1 - lam)
            s = [1.0 - 2.0 * g for g in np.indices(models[oms[0]].shape)]
            pos = {l: i for i, l in enumerate(R)}
            sets = [[pos[l] for l in p if l in pos] for p in relevant] + [[i] for i in range(len(R))]
            for a in range(len(oms)):
                for b in range(a):
                    m, m2 = models[oms[a]], models[oms[b]]
                    for T in sets:
                        f = np.ones(m.shape)
                        for i in T:
                            f = f * s[i]
                        lhs = abs(m.mean(f) - m2.mean(f))
                        rhs = C * 2 * w[T].sum()
                        claim("C.6 (D=3 gauge) products of links", lhs, rhs)
                        best = max(best, lhs / rhs)
        print("-- D=3, 3x3x3, R = 12 links of a cube, beta = %.2f, alpha = %.4f: distances d(k,B) = %s, max c/tanh(beta n) %.4f, "
              "max row sum/alpha %.4f, C.6 tightest lhs/rhs %.5f" % (beta, alpha, sorted(set(dist.tolist())), cmax_ratio, rowmax / alpha, best))


def main():
    rng = np.random.default_rng(20261115)
    part_a(rng)
    part_a(rng, strong=True)
    part_b(rng)
    print("VIOLATIONS: %d" % len(VIOL))
    for v in VIOL[:20]:
        print("   ", v)
    return len(VIOL)


if __name__ == "__main__":
    sys.exit(1 if main() else 0)
