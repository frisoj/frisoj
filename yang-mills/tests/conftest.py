"""Shared pytest configuration for the yang-mills project.

* Forces single-threaded numba / BLAS (the machine is shared; all kernels are serial anyway).
* Makes the project root importable (``import ym``) regardless of how pytest is invoked.
* Registers the ``slow`` marker.  Tests marked ``@pytest.mark.slow`` are SKIPPED by default so
  that the default test run stays short; they run when either ``--runslow`` is given or the
  ``-m`` expression mentions ``slow`` (e.g. ``-m slow``).
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("NUMBA_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

_ROOT = str(Path(__file__).resolve().parents[1])
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import pytest  # noqa: E402


def pytest_addoption(parser):
    parser.addoption("--runslow", action="store_true", default=False,
                     help="also run tests marked @pytest.mark.slow")


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "slow: long-running test, skipped unless --runslow or -m slow is given")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--runslow"):
        return
    if "slow" in (config.getoption("markexpr", default="") or ""):
        return
    skip = pytest.mark.skip(reason="slow test: use --runslow (or -m slow) to run it")
    for item in items:
        if "slow" in item.keywords:
            item.add_marker(skip)
