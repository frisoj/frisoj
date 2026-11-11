"""ym: numerical study of pure SU(2) lattice Yang-Mills theory (Wilson action) in D = 2, 3, 4.

This package produces NUMERICAL EVIDENCE (validated against exact solutions and literature
values); it is not, and must never be presented as, a proof of the Yang-Mills mass-gap problem.

Sub-modules are imported explicitly by their users (``from ym.lattice import Lattice``,
``from ym import exact``); nothing heavy is imported here so that ``import ym`` stays cheap and
independent of modules written by other contributors.
"""

__all__ = ["lattice", "exact"]
