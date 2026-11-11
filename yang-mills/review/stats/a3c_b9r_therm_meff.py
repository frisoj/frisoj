"""beta = 9 round 1: effective mass of the projected glueball operator DURING the thermalisation
phase (updates 16..1000, re-generated bit-identically) versus the first production measurements
and the production average.  A decaying thermalisation transient should be LARGER before update
1000 than after it."""
import json, math, os
import numpy as np
import lib
ser = lib.channel_series("d3_b9.0_L24r", "glue")       # round-1 vector
sel, w, ref, T = ser["sel"], ser["w"], ser["ref"], ser["T"]
prodC = None
hist = [dict(np.load("hist/d3_b9r_s%d.npz" % s, allow_pickle=False)) for s in (305, 306, 307, 308)]
upd = 2 * (np.arange(1000) + 1)
A, Bv = [], []
for h in hist:
    P = lib.project(h["glue"], sel, w, ref)
    a, b = lib.ab_series(P)
    A.append(a); Bv.append(b[:, 0])
# equilibrium vev of the projected (ref-shifted) operator from the full production sample
N = sum(x.shape[0] for x in ser["a"])
b_eq = sum(b.sum() for b in ser["b"]) / N
a_eq = sum(a.sum(axis=0) for a in ser["a"]) / N
C_eq = a_eq - b_eq ** 2
m_eq = [lib.meff_cosh(C_eq[t], C_eq[t + 1], t, T) for t in (1, 2)]
print("production (replication, all): m_eff(1) %.4f  m_eff(2) %.4f  [pipeline 0.7695(47), 0.7584(99)]" % tuple(m_eq))
def window(lo, hi, own):
    """pooled over the 4 streams; own=True: each stream subtracts its own window mean."""
    rows_a, rows_b = [], []
    for a, b in zip(A, Bv):
        m = (upd > lo) & (upd <= hi)
        rows_a.append(a[m]); rows_b.append(b[m])
    # jackknife over blocks of 25 measurements within streams
    Bz = 25
    ab = np.concatenate([lib.bins_of(x, Bz) for x in rows_a]); bb = np.concatenate([lib.bins_of(x[:, None], Bz) for x in rows_b])
    sid = np.concatenate([[i] * (x.shape[0] // Bz) for i, x in enumerate(rows_a)])
    def f(am, bm):
        C = am - (bm[0] ** 2 if own else (2 * b_eq * bm[0] - b_eq ** 2))
        return np.array([lib.meff_cosh(C[1], C[2], 1, T), lib.meff_cosh(C[2], C[3], 2, T), C[0], C[1], C[2]])
    v, e, _ = lib.jk(f, ab, bb)
    return v, e, ab.shape[0] * Bz
print("window (updates)   n_meas   m_eff(1)        m_eff(2)        C(0)/C_eq(0)   C(1)/C_eq(1)   C(2)/C_eq(2)    [vacuum: equilibrium vev from production]")
for lo, hi in ((16, 250), (250, 500), (500, 1000), (16, 1000), (1000, 1500), (1500, 2000), (1000, 2000)):
    v, e, n = window(lo, hi, False)
    print("  %5d-%-5d       %5d   %-14s  %-14s  %-13s  %-13s  %-13s   z(m1) %+.1f  z(m2) %+.1f" % (
        lo, hi, n, lib.fmt(v[0], e[0]), lib.fmt(v[1], e[1]), lib.fmt(v[2] / C_eq[0], e[2] / C_eq[0]),
        lib.fmt(v[3] / C_eq[1], e[3] / C_eq[1]), lib.fmt(v[4] / C_eq[2], e[4] / C_eq[2]),
        (v[0] - m_eq[0]) / e[0], (v[1] - m_eq[1]) / e[1]))
print("same with each window using its own mean for the vacuum subtraction (pooled over streams):")
for lo, hi in ((16, 1000), (1000, 2000)):
    v, e, n = window(lo, hi, True)
    print("  %5d-%-5d       %5d   %-14s  %-14s" % (lo, hi, n, lib.fmt(v[0], e[0]), lib.fmt(v[1], e[1])))
# reference: production measurements beyond the first 500 (updates > 2000) for round 1
