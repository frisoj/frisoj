#!/usr/bin/env python3
"""Referee C1 -- BEWIJZEN.md sections 1.2 (lattice), 4.1 (definitions of alpha, beta_0, table).

Checks, by explicit construction of the periodic lattice:
  * the four links of every plaquette are distinct;
  * (R1) every link lies in exactly 2(D-1) plaquettes;
  * (R2) sum_{k != l} n_{lk} = 6(D-1) for every link l;
  * extra facts not claimed but relevant: max n_{lk} (is it 1 for L >= 3?), connectedness of
    the link graph (so that d(k,B) is finite for B non-empty);
  * what changes for an extent equal to 2 (hypothesis L >= 3 violated);
  * alpha(beta, D), beta_0(D) = artanh(1/(6(D-1))) = (1/2) ln((6D-5)/(6D-7)), and the table of 4.1.

Run:  python3 review/proofs/ref_c1_lattice.py      (from yang-mills/; about 2 s)
"""
import itertools
import math
from collections import deque

import numpy as np


def build(shape):
    """links are numbered site*D + mu; a plaquette (x; mu, nu), mu < nu, is the 4-tuple
    ((x,mu), (x+mu,nu), (x+nu,mu), (x,nu)) exactly as in section 1.2."""
    D = len(shape)
    sites = list(itertools.product(*[range(L) for L in shape]))
    sidx = {s: i for i, s in enumerate(sites)}

    def shift(x, mu):
        y = list(x)
        y[mu] = (y[mu] + 1) % shape[mu]
        return tuple(y)

    def link(x, mu):
        return sidx[x] * D + mu

    plaq = []
    for x in sites:
        for mu in range(D):
            for nu in range(mu + 1, D):
                plaq.append((link(x, mu), link(shift(x, mu), nu), link(shift(x, nu), mu), link(x, nu)))
    return len(sites) * D, plaq


def nmatrix(nl, plaq):
    n = np.zeros((nl, nl), dtype=int)
    for p in plaq:
        for a in set(p):
            for b in set(p):
                if a != b:
                    n[a, b] += 1
    return n


def distances(n, src):
    nl = len(n)
    d = np.full(nl, -1)
    d[src] = 0
    q = deque([src])
    while q:
        a = q.popleft()
        for b in np.nonzero(n[a])[0]:
            if d[b] < 0:
                d[b] = d[a] + 1
                q.append(b)
    return d


def check(shape):
    D = len(shape)
    nl, plaq = build(shape)
    four = all(len(set(p)) == 4 for p in plaq)
    distinct_plaq = len({frozenset(p) for p in plaq}) == len(plaq)
    per_link = np.zeros(nl, dtype=int)
    for p in plaq:
        for a in set(p):
            per_link[a] += 1
    n = nmatrix(nl, plaq)
    rows = n.sum(axis=1)
    d = distances(n, 0)
    return dict(shape=shape, links=nl, plaq=len(plaq), four_distinct=four, plaq_distinct=distinct_plaq,
                R1=bool(np.all(per_link == 2 * (D - 1))), per_link=(per_link.min(), per_link.max()),
                R2=bool(np.all(rows == 6 * (D - 1))), rowsum=(rows.min(), rows.max()),
                nmax=int(n.max()), nsym=bool(np.all(n == n.T)), connected=bool(np.all(d >= 0)),
                diam_from_0=int(d.max()))


def main():
    ok = True
    print("== section 1.2: hypotheses satisfied (all extents >= 3) ==")
    for shape in [(3, 3), (3, 4), (4, 5), (5, 3), (3, 3, 3), (3, 4, 5), (4, 4, 4), (3, 3, 3, 3), (3, 4, 3, 5)]:
        r = check(shape)
        good = r["four_distinct"] and r["R1"] and r["R2"] and r["nsym"]
        ok &= good
        print("%-14s links %4d plaq %4d  four-distinct %s  R1 %s (per link %s, 2(D-1)=%d)  R2 %s (row sums %s, 6(D-1)=%d)"
              "  max n_lk %d  connected %s" % (r["shape"], r["links"], r["plaq"], r["four_distinct"], r["R1"], tuple(int(v) for v in r["per_link"]),
                                               2 * (len(shape) - 1), r["R2"], tuple(int(v) for v in r["rowsum"]), 6 * (len(shape) - 1), r["nmax"], r["connected"]))
        assert r["nmax"] == 1 and r["connected"] and r["plaq_distinct"]
    print("== hypothesis violated (an extent equal to 2): what survives ==")
    for shape in [(2, 2), (2, 3), (2, 2, 2), (2, 3, 4)]:
        r = check(shape)
        print("%-14s four-distinct %s  plaquettes distinct %s  R1 %s  R2 %s  max n_lk %d" % (
            r["shape"], r["four_distinct"], r["plaq_distinct"], r["R1"], r["R2"], r["nmax"]))
    print("   (so (R1), (R2) need only extents >= 2; extents >= 3 give in addition n_lk in {0,1})")

    print("== section 4.1: alpha, beta_0 and the table ==")
    for D, ref in [(2, 0.1682), (3, 0.0835), (4, 0.0556)]:
        b0 = math.atanh(1.0 / (6 * (D - 1)))
        b0b = 0.5 * math.log((6 * D - 5) / (6 * D - 7))
        print("D=%d  beta_0 = artanh(1/%d) = %.6f   (1/2)ln((6D-5)/(6D-7)) = %.6f   document %.4f   alpha(beta_0) = %.12f"
              % (D, 6 * (D - 1), b0, b0b, ref, 6 * (D - 1) * math.tanh(b0)))
        ok &= abs(b0 - b0b) < 1e-14 and abs(round(b0, 4) - ref) < 1e-12
    table = [(2, 0.05, 0.2998, 1.2048), (2, 0.10, 0.5980, 0.5142), (2, 0.15, 0.8933, 0.1128),
             (3, 0.02, 0.2400, 1.4273), (3, 0.05, 0.5995, 0.5117), (3, 0.08, 0.9580, 0.0430),
             (4, 0.01, 0.1800, 1.7148), (4, 0.03, 0.5398, 0.6165), (4, 0.05, 0.8993, 0.1062)]
    bad = 0
    for D, beta, a_doc, g_doc in table:
        a = 6 * (D - 1) * math.tanh(beta)
        g = math.log(1 / a)
        good = abs(round(a, 4) - a_doc) < 1e-12 and abs(round(g, 4) - g_doc) < 1e-12
        bad += not good
        print("D=%d beta=%.2f  alpha=%.8f (doc %.4f)  ln(1/alpha)=%.8f (doc %.4f)  %s" % (D, beta, a, a_doc, g, g_doc, "ok" if good else "LAST DIGIT DIFFERS"))
    print("table of 4.1: %d of %d rows differ from the correctly rounded value" % (bad, len(table)))
    print("ALL STRUCTURAL CHECKS PASSED" if ok else "SOME STRUCTURAL CHECK FAILED")


if __name__ == "__main__":
    main()
