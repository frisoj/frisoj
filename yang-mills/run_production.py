#!/usr/bin/env python3
"""Production driver: generate one Monte Carlo stream of pure SU(2) lattice gauge theory (Wilson
action, D = 2, 3 or 4) and store the raw time-slice operators needed for the mass-gap analysis.

Example
-------
    python3 run_production.py --shape 16,16,16 --beta 6.0 --ntherm 2000 --nmeas 20000 \\
        --nhb 1 --nor 4 --levels 2,6,12,18 --w 0.25 --seed 1 --out results/raw/d3_b6.0_L16_s1.npz

    # the same run in pieces of at most 200 s of wall-clock time (repeat until "complete"):
    python3 run_production.py <same arguments> --maxtime 200 --resume

One "compound update" = nhb heatbath sweeps followed by nor overrelaxation sweeps.  The run
does ntherm compound updates (thermalisation, nothing measured) and then nmeas cycles of
(nskip compound updates + one measurement).

Output file (numpy .npz, compressed, float64), n = number of measurements done so far:
    glue          (n, n_op, T)          glueball operators; op = k * n_loops + l for smearing
                                        level index k and loop-shape index l (labels in meta)
    torelon       (n, D-1, n_levels, T) torelon operators; first index = spatial direction - 1
    plaq, plaq_s, plaq_t   (n,)         average / spatial / temporal plaquette (unsmeared)
    plaq_t_slices, plaq_s_slices (n, T) per-time-slice plaquette sums (unsmeared)
    meta          JSON string           everything needed to reproduce and analyse the run
    state_U, state_rng_index, state_rng_keys, state_n
                                        gauge field and RNG state after the last stored
                                        measurement (for --resume; omitted with --no-state)
Operator definitions: see ym/observables.py.

Robustness
----------
* The file is rewritten atomically (temporary file + rename) every --checkpoint seconds, at
  the end, on --maxtime and on SIGINT/SIGTERM.  A run killed at any moment leaves the last
  checkpoint, which is a complete, analysable file.
* --maxtime S stops gracefully after about S seconds of wall-clock time and saves.
* --resume continues an interrupted run from its file.  Because the gauge field and the state
  of the random-number generator are restored exactly, a resumed run produces bit-for-bit the
  same data as an uninterrupted one (tested in tests/test_observables.py).
* A progress line is printed (and flushed) every --progress seconds.

This program produces Monte Carlo data, i.e. numerical evidence at finite lattice spacing and
volume.  It is not, and must not be presented as, a proof of the Yang-Mills mass-gap problem.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import platform
import signal
import sys
import time

os.environ.setdefault("NUMBA_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

import numpy as np  # noqa: E402

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

RAW_FORMAT = "ym-raw-1"
#: parameters that define the Markov chain / operator set; --resume refuses to continue a file
#: in which any of them differs
CHAIN_KEYS = ("shape", "beta", "seed", "start", "ntherm", "nhb", "nor", "nskip", "levels",
              "w", "loops")


def _int_list(text):
    return [int(x) for x in str(text).replace("x", ",").split(",") if x.strip() != ""]


def _loops(text):
    out = []
    for item in str(text).split(","):
        item = item.strip().lower()
        if not item:
            continue
        r, s = item.split("x")
        out.append((int(r), int(s)))
    return out


def build_parser():
    p = argparse.ArgumentParser(
        description="SU(2) lattice Yang-Mills production run (raw time-slice operators).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    p.add_argument("--shape", required=True, help="lattice extents, time first, e.g. 16,16,16")
    p.add_argument("--beta", type=float, required=True, help="Wilson coupling")
    p.add_argument("--ntherm", type=int, default=1000, help="thermalisation compound updates")
    p.add_argument("--nmeas", type=int, required=True, help="number of measurements")
    p.add_argument("--nhb", type=int, default=1, help="heatbath sweeps per compound update")
    p.add_argument("--nor", type=int, default=4, help="overrelaxation sweeps per compound update")
    p.add_argument("--nskip", type=int, default=1, help="compound updates per measurement")
    p.add_argument("--levels", default="2,4,8,16", help="APE smearing levels (numbers of steps)")
    p.add_argument("--w", type=float, default=0.25,
                   help="APE smearing weight; w < 0.5 is recommended, at w = 0.5 the staggered "
                        "mode is not damped (see ym/observables.py)")
    p.add_argument("--loops", default="1x1,2x2", help="glueball loop shapes, e.g. 1x1,2x2")
    p.add_argument("--seed", type=int, default=1, help="RNG seed (independent stream per seed)")
    p.add_argument("--start", choices=("hot", "cold"), default="hot", help="initial configuration")
    p.add_argument("--out", required=True, help="output .npz file")
    p.add_argument("--maxtime", type=float, default=None,
                   help="stop gracefully after this many seconds of wall-clock time")
    p.add_argument("--checkpoint", type=float, default=180.0, help="seconds between checkpoints")
    p.add_argument("--progress", type=float, default=60.0, help="seconds between progress lines")
    p.add_argument("--resume", action="store_true",
                   help="continue the run stored in --out (parameters must be identical)")
    p.add_argument("--no-state", action="store_true",
                   help="do not store the gauge field / RNG state (file cannot be resumed)")
    return p


def _versions():
    import numba
    import scipy
    return {"python": platform.python_version(), "numpy": np.__version__,
            "numba": numba.__version__, "scipy": scipy.__version__,
            "platform": platform.platform()}


def _utc_now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def atomic_savez(path, arrays):
    """Write a compressed .npz atomically: temporary file in the same directory, fsync, rename."""
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, ".%s.tmp.%d" % (os.path.basename(path), os.getpid()))
    try:
        with open(tmp, "wb") as f:
            np.savez_compressed(f, **arrays)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def load_raw(path):
    """Load a raw file written by this program.  Returns (meta dict, dict of arrays)."""
    with np.load(path, allow_pickle=False) as z:
        meta = json.loads(str(z["meta"]))
        arrays = {k: z[k] for k in z.files if k != "meta"}
    return meta, arrays


class Run:
    """State of one production run (also used by the tests)."""

    def __init__(self, args):
        from ym.lattice import Lattice, get_rng_state, set_rng_state
        from ym.observables import Measurer

        self._get_rng_state = get_rng_state
        self._set_rng_state = set_rng_state
        self.args = args
        self.shape = tuple(_int_list(args.shape))
        self.levels = tuple(_int_list(args.levels))
        self.loops = tuple(_loops(args.loops))
        if args.nmeas < 0 or args.ntherm < 0 or args.nskip < 1 or args.nhb < 0 or args.nor < 0:
            raise SystemExit("need nmeas >= 0, ntherm >= 0, nskip >= 1, nhb >= 0, nor >= 0")
        if args.nhb == 0:
            raise SystemExit("nhb = 0 is not ergodic (overrelaxation alone conserves the action)")
        self.chain = {"shape": list(self.shape), "beta": float(args.beta), "seed": int(args.seed),
                      "start": args.start, "ntherm": int(args.ntherm), "nhb": int(args.nhb),
                      "nor": int(args.nor), "nskip": int(args.nskip),
                      "levels": list(self.levels), "w": float(args.w),
                      "loops": [list(x) for x in self.loops]}
        self.measurer = Measurer(self.shape, self.levels, args.w, self.loops)
        m = self.measurer
        self.T = self.shape[0]
        self.n_op = m.n_levels * m.n_loops
        n = int(args.nmeas)
        self.glue = np.zeros((n, self.n_op, self.T))
        self.torelon = np.zeros((n, m.n_dirs, m.n_levels, self.T))
        self.plaq = np.zeros(n)
        self.plaq_s = np.zeros(n)
        self.plaq_t = np.zeros(n)
        self.plaq_t_slices = np.zeros((n, self.T))
        self.plaq_s_slices = np.zeros((n, self.T))
        self.n_done = 0
        self.ntherm_done = 0
        self.wall_prev = 0.0          # wall-clock of earlier invocations
        self.wall_therm = 0.0
        self.wall_meas = 0.0
        self.n_invocations = 1
        self.started_utc = _utc_now()
        self.stop_reason = None

        self.lat = Lattice(self.shape, args.beta, seed=args.seed)
        resumed = False
        if args.resume:
            # temporary files left behind by a run that was killed while writing a checkpoint
            d = os.path.dirname(os.path.abspath(args.out))
            prefix = ".%s.tmp." % os.path.basename(args.out)
            if os.path.isdir(d):
                for name in os.listdir(d):
                    if name.startswith(prefix):
                        try:
                            os.remove(os.path.join(d, name))
                        except OSError:
                            pass
        if args.resume and os.path.exists(args.out):
            self._resume(args.out)
            resumed = True
        elif os.path.exists(args.out) and not args.resume:
            raise SystemExit("output file %s exists; use --resume to continue it or remove it"
                             % args.out)
        if not resumed and args.start == "hot":
            self.lat.hot_start()
        self.resumed = resumed

    # ------------------------------------------------------------------------------------
    def _resume(self, path):
        meta, arr = load_raw(path)
        if meta.get("format") != RAW_FORMAT:
            raise SystemExit("cannot resume: %s is not a %s file" % (path, RAW_FORMAT))
        for key in CHAIN_KEYS:
            if meta[key] != self.chain[key]:
                raise SystemExit("cannot resume: parameter %s differs (file: %r, command line: %r)"
                                 % (key, meta[key], self.chain[key]))
        if "state_U" not in arr:
            raise SystemExit("cannot resume: %s was written with --no-state" % path)
        n = int(arr["state_n"])
        if n > arr["glue"].shape[0]:
            raise SystemExit("cannot resume: corrupt file (state_n > stored measurements)")
        if n > self.glue.shape[0]:
            raise SystemExit("cannot resume: the file already holds %d measurements, more than "
                             "--nmeas %d" % (n, self.glue.shape[0]))
        self.glue[:n] = arr["glue"][:n]
        self.torelon[:n] = arr["torelon"][:n]
        self.plaq[:n] = arr["plaq"][:n]
        self.plaq_s[:n] = arr["plaq_s"][:n]
        self.plaq_t[:n] = arr["plaq_t"][:n]
        self.plaq_t_slices[:n] = arr["plaq_t_slices"][:n]
        self.plaq_s_slices[:n] = arr["plaq_s_slices"][:n]
        self.n_done = n
        self.ntherm_done = int(meta["ntherm_done"])
        self.lat.U[...] = arr["state_U"]
        self._set_rng_state((int(arr["state_rng_index"]),
                             [int(k) for k in arr["state_rng_keys"]]))
        self.wall_prev = float(meta.get("wall_clock_s", 0.0))
        self.wall_therm = float(meta.get("wall_clock_therm_s", 0.0))
        self.wall_meas = float(meta.get("wall_clock_meas_s", 0.0))
        self.n_invocations = int(meta.get("n_invocations", 1)) + 1
        self.started_utc = meta.get("started_utc", self.started_utc)

    # ------------------------------------------------------------------------------------
    def meta(self, wall_now):
        m = self.measurer
        complete = (self.n_done >= self.glue.shape[0]
                    and self.ntherm_done >= self.chain["ntherm"])
        cyc = self.wall_meas / self.n_done if self.n_done > 0 else None
        d = dict(self.chain)
        d.update({
            "format": RAW_FORMAT,
            "D": len(self.shape),
            "T": self.T,
            "ntherm_done": int(self.ntherm_done),
            "nmeas_requested": int(self.glue.shape[0]),
            "nmeas_done": int(self.n_done),
            "complete": bool(complete),
            "stop_reason": self.stop_reason if not complete else "complete",
            "glue_ops": m.glue_labels(),
            "glue_op_level": [int(lev) for lev in m.levels for _ in m.loops],
            "glue_op_loop": [list(lp) for _ in m.levels for lp in m.loops],
            "torelon_ops": m.torelon_labels(),
            "torelon_dirs": list(range(1, len(self.shape))),
            "torelon_L": [int(x) for x in self.shape[1:]],
            "sweeps_per_measurement": {"heatbath": self.chain["nskip"] * self.chain["nhb"],
                                       "overrelax": self.chain["nskip"] * self.chain["nor"]},
            "wall_clock_s": float(self.wall_prev + wall_now),
            "wall_clock_therm_s": float(self.wall_therm),
            "wall_clock_meas_s": float(self.wall_meas),
            "seconds_per_cycle": cyc,
            "n_invocations": int(self.n_invocations),
            "started_utc": self.started_utc,
            "saved_utc": _utc_now(),
            "unitarity_violation": self.lat.unitarity_violation(),
            "plaq_running_mean": float(self.plaq[:self.n_done].mean()) if self.n_done else None,
            "versions": _versions(),
            "command": " ".join(sys.argv),
            "note": "Monte Carlo data (numerical evidence at finite lattice spacing and "
                    "volume); not a proof of the Yang-Mills mass gap.",
        })
        return d

    def save(self, wall_now):
        n = self.n_done
        arrays = {
            "glue": self.glue[:n], "torelon": self.torelon[:n],
            "plaq": self.plaq[:n], "plaq_s": self.plaq_s[:n], "plaq_t": self.plaq_t[:n],
            "plaq_t_slices": self.plaq_t_slices[:n], "plaq_s_slices": self.plaq_s_slices[:n],
            "meta": np.array(json.dumps(self.meta(wall_now))),
        }
        if not self.args.no_state:
            idx, keys = self._get_rng_state()
            arrays["state_U"] = self.lat.U
            arrays["state_rng_index"] = np.array(idx, dtype=np.int64)
            arrays["state_rng_keys"] = np.array(keys, dtype=np.uint32)
            arrays["state_n"] = np.array(n, dtype=np.int64)
        atomic_savez(self.args.out, arrays)

    # ------------------------------------------------------------------------------------
    def run(self, out=sys.stdout):
        a = self.args
        lat = self.lat
        nmeas = self.glue.shape[0]
        ntherm = self.chain["ntherm"]
        t_start = time.time()
        last_ckpt = t_start
        last_prog = t_start
        stop = {"flag": False, "why": None}

        def handler(signum, frame):
            stop["flag"] = True
            stop["why"] = "signal %d" % signum

        old = {}
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                old[sig] = signal.signal(sig, handler)
            except (ValueError, OSError):       # not in the main thread
                pass

        def say(msg):
            print(msg, file=out, flush=True)

        def out_of_time(now):
            return a.maxtime is not None and (now - t_start) >= a.maxtime

        say("# run_production: shape=%s beta=%g seed=%d start=%s ntherm=%d nmeas=%d "
            "nhb=%d nor=%d nskip=%d levels=%s w=%g loops=%s out=%s%s"
            % (",".join(map(str, self.shape)), a.beta, a.seed, a.start, ntherm, nmeas, a.nhb,
               a.nor, a.nskip, ",".join(map(str, self.levels)), a.w,
               ",".join("%dx%d" % x for x in self.loops), a.out,
               " (RESUMED at therm %d, meas %d)" % (self.ntherm_done, self.n_done)
               if self.resumed else ""))
        if a.w >= 0.5 and len(self.shape) > 2:
            say("# WARNING: APE weight w = %g >= 0.5: the staggered mode is not damped, loops with "
                "odd side lengths built from smeared links have poor overlap (see "
                "ym/observables.py); w = 0.25 is recommended" % a.w)

        def progress(now, phase):
            el = now - t_start
            if self.n_done > 0:
                pm = "%.6f" % self.plaq[:self.n_done].mean()
                spc = "%.3g" % (self.wall_meas / self.n_done)
                eta = "%.0f" % ((nmeas - self.n_done) * self.wall_meas / self.n_done)
            else:
                pm, spc, eta = "%.6f (current)" % lat.plaquette(), "n/a", "n/a"
            say("[progress] %s | therm %d/%d | meas %d/%d | elapsed %.1f s (total %.1f s) | "
                "%s s/cycle | plaq mean %s | ETA %s s"
                % (phase, self.ntherm_done, ntherm, self.n_done, nmeas, el,
                   self.wall_prev + el, spc, pm, eta))

        # ---------------- thermalisation ----------------
        t_phase = time.time()
        while self.ntherm_done < ntherm and not stop["flag"]:
            lat.update(a.nhb, a.nor)
            self.ntherm_done += 1
            now = time.time()
            if now - last_prog >= a.progress:
                progress(now, "thermalising")
                last_prog = now
            if out_of_time(now):
                stop["flag"] = True
                stop["why"] = "maxtime"
            elif now - last_ckpt >= a.checkpoint:
                self.wall_therm += now - t_phase
                t_phase = now
                self.save(now - t_start)
                last_ckpt = time.time()
        self.wall_therm += time.time() - t_phase

        # ---------------- measurements ----------------
        t_phase = time.time()
        while self.n_done < nmeas and not stop["flag"]:
            for _ in range(a.nskip):
                lat.update(a.nhb, a.nor)
            r = self.measurer(lat)
            i = self.n_done
            self.glue[i] = r["glue"].reshape(self.n_op, self.T)
            self.torelon[i] = r["torelon"]
            self.plaq[i] = r["plaq"]
            self.plaq_s[i] = r["plaq_s"]
            self.plaq_t[i] = r["plaq_t"]
            self.plaq_t_slices[i] = r["plaq_t_slices"]
            self.plaq_s_slices[i] = r["plaq_s_slices"]
            self.n_done = i + 1
            now = time.time()
            self.wall_meas += now - t_phase
            t_phase = now
            if now - last_prog >= a.progress:
                progress(now, "measuring")
                last_prog = now
            if out_of_time(now):
                stop["flag"] = True
                stop["why"] = "maxtime"
            elif now - last_ckpt >= a.checkpoint and self.n_done < nmeas:
                self.save(now - t_start)
                last_ckpt = time.time()
                t_phase = last_ckpt            # do not count the checkpoint as cycle time
                say("[checkpoint] %d measurements saved to %s" % (self.n_done, a.out))

        self.stop_reason = stop["why"]
        now = time.time()
        self.save(now - t_start)
        for sig, h in old.items():
            signal.signal(sig, h)
        progress(now, "finished" if self.n_done >= nmeas else "stopped (%s)" % stop["why"])
        say("# saved %d measurements to %s (%s)"
            % (self.n_done, a.out,
               "complete" if self.n_done >= nmeas else "INCOMPLETE: " + str(stop["why"])))
        return 0


def main(argv=None):
    args = build_parser().parse_args(argv)
    run = Run(args)
    return run.run()


if __name__ == "__main__":
    sys.exit(main())
