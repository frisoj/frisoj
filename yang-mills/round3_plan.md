# Round 3: analysis plan, fixed before the data were looked at

Numerical evidence at finite lattice spacing and volume, not a proof.

Written on 2026-11-11 at 22:35 UTC, about two minutes after the round-3 run
`d4_b2.5_L20` started (see `run_round3_production.sh`, committed before the
run), while all four streams were still thermalising (stream 901 was at
update 383 of 1000) and no measurement existed. The criterion in the header of
`run_round3_production.sh` stays as it is; this file adds what will be
computed with the new ensemble, so that none of it is chosen after seeing it.

1. `d4_b2.5_L20` is analysed alone with the unchanged pipeline
   (`analyze.py`, rules R1-R8) and with `independent_analysis.py`.
   Reported: R5 value, `m_eff(1)`, `m_eff(2)`, torelon energy,
   `a*sqrt(sigma)` (Nambu-Goto), plaquette, bin count, stream consistency.
2. Volume comparison at beta = 2.5: `d4_b2.5_L20` against
   `d4_b2.5_L16_combined`, for the glueball `m_eff(1)`, `m_eff(2)`, the
   plaquette and `a*sqrt(sigma)`; differences in units of the combined error.
3. The product `a*m*L` at beta = 2.5 for L = 16 and L = 20, and the exponent
   q in `m ~ L^-q` from the two volumes (q = 1 is a pure finite-size gap,
   q = 0 a volume-independent gap), as was done for beta = 2.4.
4. A second D=4 set, "largest volume per beta": `d4_b2.3_L10`, `d4_b2.4_L16`,
   `d4_b2.5_L20` (box sizes L*a*sqrt(sigma) of about 3.6, 4.2 and 3.7). For
   this set `m/sqrt(sigma)` is tabulated at fixed t = 1 and with R5, with the
   chi2 of a constant. It is shown next to the pre-registered primary set,
   not instead of it. No continuum value is quoted from either set.
5. The exploratory torelon-pair test of the physics review is not repeated as
   a primary number. If it is repeated on L = 20 it is labelled exploratory.
6. The new numbers are added to the report whatever they are. If the streams
   stop early (time limit, restart), the measurements available are analysed
   and the shortfall is stated.
