#!/usr/bin/env python3
"""Referee D (round 2) -- BEWIJZEN.md section 4.5, point 3 (geometry of the new lifting argument).

Links of Z^D: (x, mu); varrho(k) = largest |coordinate| of the two end points; R_r = {varrho <= r};
Q_r = {-r..r}^D.  Periodic lattice (Z/L)^D, projection x -> x mod L.  Checked by brute force:

 (1) first paragraph, at the smallest allowed size L = 2r+3: every plaquette of the periodic lattice
     that contains (the image of) a link of R_r is the image of exactly one plaquette of Z^D with
     corners in Q_{r+1}, link by link, and the projection is injective on the links inside Q_{r+1}.
     (For L = 2r+2 the projection is no longer injective on those links; printed for comparison.)
 (2) second paragraph: d_L(k, complement of R_r) >= r + 1 - varrho(k) for every k in R_r.
 (3) last paragraphs: for disjoint non-empty A, B inside R_{r0}, n = max_{k in A} d(k,B),
     r = r0 + n and every L in {2r+3, ..., 2r+6}:  d_L(k,B) = d(k,B) for every k in A.
     Also printed: how often the equality fails at the smallest L for which f, g are defined
     as functions on the periodic lattice (L = 2 r0 + 1), and the largest L < 2r+3 at which a
     failure occurs, which shows that "L large enough" really needs a quantitative choice.

Run:  python3 review/proofs/ref_d_lifting.py      (from yang-mills/; about 20 s)
"""
import itertools

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

rng = np.random.default_rng(4051)


def build(D, sites, step):
    """links, plaquettes (as 4-tuples of link keys) and the neighbour graph of a lattice."""
    links = {}
    for x in sites:
        for mu in range(D):
            if step(x, mu) is not None:
                links[(x, mu)] = len(links)
    plaqs = []
    for x in sites:
        for mu in range(D):
            for nu in range(mu + 1, D):
                xm, xn = step(x, mu), step(x, nu)
                if xm is None or xn is None or step(xm, nu) is None:
                    continue
                plaqs.append(((x, mu), (xm, nu), (xn, mu), (x, nu)))
    rows, cols = [], []
    for p in plaqs:
        ids = [links[k] for k in p]
        assert len(set(ids)) == 4
        for a in ids:
            for b in ids:
                if a != b:
                    rows.append(a)
                    cols.append(b)
    n = len(links)
    graph = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n)).tocsr()
    graph.data[:] = 1.0
    return links, plaqs, graph


def box(D, M):
    sites = list(itertools.product(range(-M, M + 1), repeat=D))

    def step(x, mu):
        if x[mu] + 1 > M:
            return None
        return x[:mu] + (x[mu] + 1,) + x[mu + 1:]
    return build(D, sites, step)


def torus(D, L):
    sites = list(itertools.product(range(L), repeat=D))

    def step(x, mu):
        return x[:mu] + ((x[mu] + 1) % L,) + x[mu + 1:]
    return build(D, sites, step)


def varrho(k):
    x, mu = k
    return max(max(abs(c) for c in x), abs(x[mu] + 1))


def proj(k, L):
    x, mu = k
    return (tuple(c % L for c in x), mu)


def dist_to(graph, sources):
    return dijkstra(graph, unweighted=True, indices=sorted(sources), min_only=True)


for D in (2, 3):
    print(f"=== D = {D} ===")
    # ---------- (1) and (2)
    for r in ((1, 2, 3) if D == 2 else (1, 2)):
        blinks, bplaqs, _ = box(D, r + 1)
        for L in (2 * r + 3, 2 * r + 2):
            tlinks, tplaqs, tgraph = torus(D, L)
            lifted = {}
            for p in bplaqs:
                key = frozenset(proj(k, L) for k in p)
                lifted[key] = lifted.get(key, 0) + 1
            Rr = [k for k in blinks if varrho(k) <= r]
            imgR = {proj(k, L) for k in Rr}
            bad = 0
            touching = 0
            for p in tplaqs:
                if any(k in imgR for k in p):
                    touching += 1
                    if lifted.get(frozenset(p), 0) != 1:
                        bad += 1
            inj = len({proj(k, L) for k in blinks}) == len(blinks)
            msg = (f"  r={r}, L={L}: {touching} periodic plaquettes touch R_r; not the image of exactly one plaquette"
                   f" in Q_(r+1): {bad}; projection injective on links in Q_(r+1): {inj}")
            if L == 2 * r + 3:
                assert bad == 0 and inj and len(imgR) == len(Rr)
                comp = [tlinks[k] for k in tlinks if k not in imgR]
                d = dist_to(tgraph, comp)
                slack = min(d[tlinks[proj(k, L)]] - (r + 1 - varrho(k)) for k in Rr)
                assert slack >= 0
                msg += f";  min over k of d_L(k, R_r^c) - (r+1-varrho(k)) = {slack:.0f}"
            else:
                assert not inj
                msg += "   (L = 2r+2: injectivity must fail)"
            print(msg)
    # ---------- (3)
    r0 = 1
    M = r0 + (9 if D == 2 else 6)
    blinks, bplaqs, bgraph = box(D, M)
    R0 = [k for k in blinks if varrho(k) <= r0]
    tor = {}
    ntrial = 300 if D == 2 else 60
    nfail_small = 0
    nmax = 0
    closest = None                                    # smallest (2r+3) - L at which equality fails
    for trial in range(ntrial):
        if trial < len(R0) and D == 2:               # some singleton pairs first
            A = [R0[trial]]
            B = [R0[(trial * 7 + 3) % len(R0)]]
            if A == B:
                continue
        else:
            perm = rng.permutation(len(R0))
            na = int(rng.integers(1, 4))
            nb = int(rng.integers(1, 4))
            A = [R0[i] for i in perm[:na]]
            B = [R0[i] for i in perm[na:na + nb]]
        dZ = dist_to(bgraph, [blinks[k] for k in B])
        dA = {k: int(dZ[blinks[k]]) for k in A}
        n = max(dA.values())
        nmax = max(nmax, n)
        assert r0 + n <= M - 1                       # the box contains every shortest path
        r = r0 + n
        for L in range(2 * r0 + 1, 2 * r + 7):
            if L not in tor:
                tor[L] = torus(D, L)
            tlinks, _, tgraph = tor[L]
            dT = dist_to(tgraph, [tlinks[proj(k, L)] for k in B])
            equal = all(int(dT[tlinks[proj(k, L)]]) == dA[k] for k in A)
            if L >= 2 * r + 3:
                assert equal, (D, A, B, L)
            elif not equal:
                nfail_small += (L == 2 * r0 + 1)
                gap = 2 * r + 3 - L
                closest = gap if closest is None else min(closest, gap)
    print(f"  {ntrial} pairs (A,B) in R_1, largest n = {nmax}: d_L(k,B) = d(k,B) for all k in A and all L in 2r+3..2r+6 (r = r0+n): True")
    print(f"  same pairs at L = 2 r0 + 1 = {2 * r0 + 1}: equality fails for {nfail_small} pairs;"
          f" failures occur up to L = (2r+3) - {closest}")
