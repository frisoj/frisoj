#!/usr/bin/env python3
"""Referee check of Stelling A, point 5 (first formula) for the real group SU(2).

A heat-bath simulation (ym.lattice, no transfer matrix involved) samples the measure mu on a
D = 2 lattice with L = 4 spatial sites and N = 4 time slices.  Observable: W(u) = Tr h(u), the
trace of the holonomy around the spatial ring (bounded, continuous, gauge invariant).
Point 5 says   mu(W(u^0) W(u^t)) = Tr(W T^t W T^(N-t)) / Tr T^N.
The right-hand side is evaluated in the eigenbasis chi_j o h of T on H_inv (Stelling B, point 2:
Lambda_j = (2 I_{2j+1}(beta)/beta)^L) with W chi_j = chi_{j+1/2} + chi_{j-1/2}:
    Tr(W T^t W T^(N-t)) = sum_{|j-k|=1/2} Lambda_j^(N-t) Lambda_k^t .
So this is a joint test of point 5 of Stelling A and the spectrum of Stelling B.
Also checked: the PSD Gram test of the kernel K on tightly clustered points (step 3).

Run:  python3 review/proofs/ref_a_su2_mc_corr.py     (from yang-mills/)
"""
import os
import sys

import numpy as np
from scipy.special import iv

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from ym.lattice import Lattice  # noqa: E402


def exact_corr(beta, L, N, t, nmax=200):
    lamj = (2.0 / beta * iv(np.arange(1, nmax + 1), beta)) ** L
    lamj = lamj / lamj[0]
    num = np.sum(lamj[1:] ** (N - t) * lamj[:-1] ** t + lamj[:-1] ** (N - t) * lamj[1:] ** t)
    return num / np.sum(lamj ** N)


def block_err(x, nb=50):
    n = (len(x) // nb) * nb
    b = x[:n].reshape(nb, -1).mean(axis=1)
    return b.mean(), b.std(ddof=1) / np.sqrt(nb)


if __name__ == "__main__":
    beta, L, N = 4.0, 4, 4
    lat = Lattice((N, L), beta, seed=12345)        # axis 0 = time, axis 1 = space
    lat.hot_start()
    lat.update(n_hb=2000, n_or=0)
    nmeas = 250000
    W = np.empty((nmeas, N))
    for i in range(nmeas):
        lat.update(n_hb=1, n_or=0)
        W[i] = 2.0 * lat.polyakov_loops(1)         # Tr h(u^t), one per time slice
    print(f"SU(2), D=2, L={L}, N={N}, beta={beta}, {nmeas} heat-bath sweeps")
    m1, e1 = block_err(W.mean(axis=1))
    print(f"  mu(W(u^0))            MC = {m1:+.5f} +- {e1:.5f};  trace formula = 0 (W chi_j has no chi_j component)")
    for t in range(1, N):
        c = np.mean(W * np.roll(W, -t, axis=1), axis=1)
        m, e = block_err(c)
        ex = exact_corr(beta, L, N, t)
        print(f"  mu(W(u^0)W(u^{t}))      MC = {m:.5f} +- {e:.5f};  Tr(W T^t W T^(N-t))/Tr T^N = {ex:.5f};  dev = {(m-ex)/e:+.2f} sigma")
    # zero-separation value for orientation: mu(W^2) (not covered by point 5, t >= 1)
    m, e = block_err(np.mean(W * W, axis=1))
    print(f"  (t=0, not part of point 5: mu(W^2) MC = {m:.5f} +- {e:.5f})")

    # step 3: Gram matrices of K on tightly clustered points (near-singular, so a kernel that is
    # not positive semidefinite would show a clearly negative eigenvalue)
    rng = np.random.default_rng(7)

    def rand_su2(shape):
        q = rng.normal(size=tuple(shape) + (4,))
        q /= np.linalg.norm(q, axis=-1, keepdims=True)
        return q

    def qmat(q):
        m = np.empty(q.shape[:-1] + (2, 2), dtype=complex)
        m[..., 0, 0] = q[..., 0] + 1j * q[..., 3]
        m[..., 0, 1] = q[..., 2] + 1j * q[..., 1]
        m[..., 1, 0] = -q[..., 2] + 1j * q[..., 1]
        m[..., 1, 1] = q[..., 0] - 1j * q[..., 3]
        return m

    for nE, bet, eps in [(3, 1.0, 0.3), (3, 6.0, 0.1), (18, 2.3, 0.05)]:
        base = rand_su2((nE,))
        pts = base[None] + eps * rng.normal(size=(300, nE, 4))
        pts /= np.linalg.norm(pts, axis=-1, keepdims=True)
        us = qmat(pts)
        G = np.exp((bet / 2) * np.real(np.einsum("aeij,beij->ab", us, np.conj(us))))
        ev = np.linalg.eigvalsh(G)
        print(f"  Gram K, |E|={nE}, beta={bet}, 300 points within ~{eps} of one configuration: min eig/max eig = {ev.min()/ev.max():+.2e}"
              f"  (max eig {ev.max():.3e}, #eig < -1e-10*max: {int(np.sum(ev < -1e-10*ev.max()))})")
