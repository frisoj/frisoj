#!/usr/bin/env python3
"""Referee C2 -- BEWIJZEN.md sections 1.2 and 4.5: geometry used by Stelling C.

Brute force, with the conventions of section 1.2 (plaquette (x; mu, nu), mu < nu, contains the
links (x,mu), (x+mu,nu), (x+nu,mu), (x,nu)).

Part 1  (R1), (R2), distinct links, on tori with extents 3, 4, 5 in D = 2, 3, 4 (plus mixed
        extents and, for contrast, extents 2).
Part 2  proof of point 2: A = spatial links of time layer 0, B = those of layer t.
        Breadth-first search for d(A,B); claim d(A,B) >= t for 1 <= t <= N/2.
Part 3  proof of point 3: cube Q_r, link set R_r, torus (Z/L)^D with L >= 2r+3:
        (a) neighbours differ by at most 1 in rho;
        (b) every torus plaquette touching R_r has its corners in the image of Q_{r+1} and is the
            image of a plaquette of Z^D; the set of such plaquettes (as 4-tuples of Z^D links) is
            the same for every L >= 2r+3 and equals the set computed in Z^D itself;
        (c) d(k,B) >= r + 1 - rho(k) on the torus;
        (d) what happens for L = 2r+2;
        (e) link distance on the torus versus Z^D for two finite sets A, B.

Run:  python3 review/proofs/ref_c2_geometry.py      (from yang-mills/; about 1 s)
"""
import itertools
from collections import deque

import numpy as np


class Torus:
    def __init__(self, shape):
        self.shape = tuple(shape)
        self.D = D = len(shape)
        self.sites = list(itertools.product(*[range(n) for n in shape]))
        self.sidx = {s: i for i, s in enumerate(self.sites)}
        self.nl = len(self.sites) * D
        self.plaq = []          # 4-tuples of link indices
        self.plaq_label = []    # (x, mu, nu)
        for x in self.sites:
            for mu in range(D):
                for nu in range(mu + 1, D):
                    self.plaq.append((self.link(x, mu), self.link(self.shift(x, mu), nu),
                                      self.link(self.shift(x, nu), mu), self.link(x, nu)))
                    self.plaq_label.append((x, mu, nu))
        self.through = [[] for _ in range(self.nl)]     # plaquettes through each link
        for ip, p in enumerate(self.plaq):
            for a in set(p):
                self.through[a].append(ip)
        self.nbr = [set() for _ in range(self.nl)]
        for p in self.plaq:
            for a in p:
                for b in p:
                    if a != b:
                        self.nbr[a].add(b)

    def shift(self, x, mu, s=1):
        y = list(x)
        y[mu] = (y[mu] + s) % self.shape[mu]
        return tuple(y)

    def link(self, x, mu):
        return self.sidx[x] * self.D + mu

    def bfs(self, sources):
        d = np.full(self.nl, -1, dtype=int)
        q = deque()
        for s in sources:
            d[s] = 0
            q.append(s)
        while q:
            a = q.popleft()
            for b in self.nbr[a]:
                if d[b] < 0:
                    d[b] = d[a] + 1
                    q.append(b)
        return d


def part1():
    print("=== Part 1: (R1), (R2), distinct links ===")
    shapes = []
    for D in (2, 3, 4):
        for L in (3, 4, 5):
            shapes.append((L,) * D)
    shapes += [(3, 4), (3, 5, 4), (3, 4, 5, 3), (3, 7), (6, 3, 3)]
    allok = True
    for shape in shapes:
        T = Torus(shape)
        D = T.D
        distinct = all(len(set(p)) == 4 for p in T.plaq)
        # no two plaquettes with the same link set
        nodup = len({frozenset(p) for p in T.plaq}) == len(T.plaq)
        cnt = np.array([len(t) for t in T.through])
        r1 = bool((cnt == 2 * (D - 1)).all())
        # (R1) in detail: for each link (x,mu) and each nu != mu exactly the plaquettes based at x
        # and at x - nu in the (mu,nu)-plane
        detail = True
        for x in T.sites:
            for mu in range(D):
                want = set()
                for nu in range(D):
                    if nu == mu:
                        continue
                    a, b = min(mu, nu), max(mu, nu)
                    want.add((x, a, b))
                    want.add((T.shift(x, nu, -1), a, b))
                got = {T.plaq_label[ip] for ip in T.through[T.link(x, mu)]}
                detail &= (want == got and len(want) == 2 * (D - 1))
        # n_{lk}
        nmax, r2 = 0, True
        nnbr = set()
        for l in range(T.nl):
            c = {}
            for ip in T.through[l]:
                for k in T.plaq[ip]:
                    if k != l:
                        c[k] = c.get(k, 0) + 1
            r2 &= (sum(c.values()) == 6 * (D - 1))
            nmax = max(nmax, max(c.values()))
            nnbr.add(len(c))
        conn = bool((T.bfs([0]) >= 0).all())
        ok = distinct and nodup and r1 and detail and r2 and conn
        allok &= ok
        print(f" shape {str(shape):14s} links {T.nl:5d} plaq {len(T.plaq):5d}: 4 links distinct {distinct}, "
              f"(R1) {r1} (detail {detail}), (R2) {r2}, max n_lk = {nmax}, #neighbours = {sorted(nnbr)}, "
              f"link graph connected {conn}")
    print(" all hypotheses-satisfying shapes OK:", allok)
    print(" -- for contrast, shapes with an extent 2 (outside the hypotheses):")
    for shape in [(2, 2), (2, 3), (2, 2, 2), (2, 3, 4)]:
        T = Torus(shape)
        D = T.D
        distinct = all(len(set(p)) == 4 for p in T.plaq)
        nodup = len({frozenset(p) for p in T.plaq}) == len(T.plaq)
        cnt = np.array([len(t) for t in T.through])
        nmax, sums = 0, set()
        for l in range(T.nl):
            c = {}
            for ip in T.through[l]:
                for k in T.plaq[ip]:
                    if k != l:
                        c[k] = c.get(k, 0) + 1
            sums.add(sum(c.values()))
            nmax = max(nmax, max(c.values()))
        print(f" shape {str(shape):10s}: 4 links distinct {distinct}, plaquettes have distinct link sets {nodup}, "
              f"plaquettes per link {sorted(set(cnt.tolist()))} (2(D-1) = {2*(D-1)}), sum n_lk {sorted(sums)}, max n_lk = {nmax}")


def part2():
    print("\n=== Part 2: d(A,B) for time layers (proof of point 2) ===")
    cases = [((3,), range(3, 10)), ((4,), range(3, 8)), ((3, 3), range(3, 9)), ((3, 4), range(3, 7)),
             ((3, 3, 3), range(3, 7))]
    worst_ok = True
    for sshape, Ns in cases:
        for N in Ns:
            T = Torus(sshape + (N,))
            D = T.D
            tdir = D - 1
            layer = lambda t: [T.link(x, mu) for x in T.sites if x[tdir] == t for mu in range(D - 1)]
            A = layer(0)
            # time coordinate of every link, and the neighbour property
            tc = np.zeros(T.nl)
            for x in T.sites:
                for mu in range(D):
                    tc[T.link(x, mu)] = x[tdir] + (0.5 if mu == tdir else 0.0)
            maxstep = 0.0
            for a in range(T.nl):
                for b in T.nbr[a]:
                    dd = abs(tc[a] - tc[b])
                    maxstep = max(maxstep, min(dd, N - dd))
            dA = T.bfs(A)
            row = []
            for t in range(1, N):
                B = layer(t)
                dmin = int(dA[B].min())
                dmax = int(dA[B].max())
                # per-link: d(k,B) for k in A
                dB = T.bfs(B)
                per = (int(dB[A].min()), int(dB[A].max()))
                row.append((t, dmin, dmax, per))
                if t <= N / 2:
                    worst_ok &= (dmin >= t) and (per[0] >= t)
                worst_ok &= (dmin == min(t, N - t))
            txt = ", ".join(f"t={t}: d(A,B)={dmin} [d(k,B) in {per}]" for t, dmin, dmax, per in row)
            print(f" spatial {sshape}, N={N}: max circular time step between neighbours = {maxstep}; {txt}")
    print(" claim d(A,B) >= t for 1 <= t <= N/2 holds in all cases (and d(A,B) = min(t, N-t)):", worst_ok)


def cube_links(D, r):
    """links of Z^D with both endpoints in Q_r, as ((x), mu) with integer coordinates."""
    out = []
    for x in itertools.product(range(-r, r + 1), repeat=D):
        for mu in range(D):
            if x[mu] + 1 <= r:
                out.append((x, mu))
    return out


def rho(link):
    x, mu = link
    y = list(x)
    y[mu] += 1
    return max(max(abs(c) for c in x), max(abs(c) for c in y))


def zd_plaquettes_touching(D, r):
    """plaquettes of Z^D (as ordered 4-tuples of Z^D links) containing at least one link of R_r."""
    Rr = set(cube_links(D, r))
    out = set()
    for x in itertools.product(range(-r - 2, r + 2), repeat=D):
        for mu in range(D):
            for nu in range(mu + 1, D):
                xm = tuple(c + (1 if i == mu else 0) for i, c in enumerate(x))
                xn = tuple(c + (1 if i == nu else 0) for i, c in enumerate(x))
                p = ((x, mu), (xm, nu), (xn, mu), (x, nu))
                if any(l in Rr for l in p):
                    out.add(p)
    return out


def part3():
    print("\n=== Part 3: embedding of the cube (proof of point 3) ===")
    # (a) neighbours differ by at most 1 in rho (checked inside a box of Z^D, plaquette by plaquette)
    for D in (2, 3, 4):
        m = 0
        box = 3 if D < 4 else 2
        for x in itertools.product(range(-box, box + 1), repeat=D):
            for mu in range(D):
                for nu in range(mu + 1, D):
                    xm = tuple(c + (1 if i == mu else 0) for i, c in enumerate(x))
                    xn = tuple(c + (1 if i == nu else 0) for i, c in enumerate(x))
                    rs = [rho(l) for l in ((x, mu), (xm, nu), (xn, mu), (x, nu))]
                    m = max(m, max(rs) - min(rs))
        print(f" (a) D={D}: max |rho(k) - rho(l)| over links of one plaquette = {m}")

    for D, rs in ((2, (1, 2, 3)), (3, (1, 2)), (4, (1,))):
        for r in rs:
            Rr = cube_links(D, r)
            ref = zd_plaquettes_touching(D, r)
            for L in (2 * r + 2, 2 * r + 3, 2 * r + 4, 2 * r + 6):
                T = Torus((L,) * D)
                proj = lambda x: tuple(c % L for c in x)
                # lift: inverse of the projection on Q_{r+1} (defined iff injective there)
                Q1 = list(itertools.product(range(-r - 1, r + 2), repeat=D))
                images = {}
                injective = True
                for x in Q1:
                    px = proj(x)
                    if px in images:
                        injective = False
                    images.setdefault(px, x)
                Rimg = [T.link(proj(x), mu) for (x, mu) in Rr]
                inj_links = len(set(Rimg)) == len(Rimg)
                Rset = set(Rimg)
                Bset = [l for l in range(T.nl) if l not in Rset]
                # (b) plaquettes touching R_r
                corners_ok, lift_ok = True, True
                lifted = set()
                for ip, p in enumerate(T.plaq):
                    if not any(l in Rset for l in p):
                        continue
                    x, mu, nu = T.plaq_label[ip]
                    cs = [x, T.shift(x, mu), T.shift(x, nu), T.shift(T.shift(x, mu), nu)]
                    if not all(c in images for c in cs):
                        corners_ok = False
                        continue
                    xl = images[x]
                    xm = tuple(c + (1 if i == mu else 0) for i, c in enumerate(xl))
                    xn = tuple(c + (1 if i == nu else 0) for i, c in enumerate(xl))
                    xmn = tuple(c + (1 if i in (mu, nu) else 0) for i, c in enumerate(xl))
                    if not (images.get(cs[1]) == xm and images.get(cs[2]) == xn and images.get(cs[3]) == xmn):
                        lift_ok = False
                        continue
                    lifted.add(((xl, mu), (xm, nu), (xn, mu), (xl, nu)))
                same = (lifted == ref)
                # (c) distances
                dB = T.bfs(Bset) if Bset else None
                viol, tight = 0, True
                if dB is not None:
                    for (x, mu), li in zip(Rr, Rimg):
                        lower = r + 1 - rho((x, mu))
                        if dB[li] < lower:
                            viol += 1
                        tight &= (dB[li] == lower)
                tag = "L>=2r+3" if L >= 2 * r + 3 else "L=2r+2 "
                print(f" D={D} r={r} L={L} ({tag}): projection injective on Q_(r+1): {injective}; R_r links distinct: {inj_links}; "
                      f"corners of touching plaquettes in image(Q_(r+1)): {corners_ok}; lifts are Z^D plaquettes: {lift_ok}; "
                      f"touching plaquettes = Z^D ones ({len(ref)}): {same}; "
                      f"d(k,B) >= r+1-rho(k) violations: {viol}, equality everywhere: {tight}")

    # (e) torus distance versus Z^D distance for two finite sets
    print(" (e) torus link distance versus Z^D (large box) link distance, D = 2:")
    D = 2
    A = [((0, 0), 0)]
    Bz = [((3, 0), 0), ((0, 2), 1)]
    for L in (4, 5, 6, 7, 9, 11, 13):
        T = Torus((L,) * D)
        a = [T.link(tuple(c % L for c in x), mu) for x, mu in A]
        b = [T.link(tuple(c % L for c in x), mu) for x, mu in Bz]
        d = T.bfs(b)
        print(f"     L={L:2d}: d_L(A,B) = {int(d[a].min())}")
    T = Torus((41, 41))
    off = 20
    a = [T.link(tuple(c + off for c in x), mu) for x, mu in A]
    b = [T.link(tuple(c + off for c in x), mu) for x, mu in Bz]
    print(f"     Z^2 (41 x 41 box, sets in the middle): d(A,B) = {int(T.bfs(b)[a].min())}")


if __name__ == "__main__":
    part1()
    part2()
    part3()
