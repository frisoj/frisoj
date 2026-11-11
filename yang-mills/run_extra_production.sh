#!/usr/bin/env bash
# Second round of runs for the SU(2) lattice Yang-Mills mass-gap study.
# Numerical evidence at finite lattice spacing and volume -- NOT a proof.
#
# These runs were decided AFTER a first look at the first-round results and
# BEFORE any of their own data existed. Their purpose is fixed here:
#
#   d3_b9.0_L24r  replication of d3_b9.0_L24 with new seeds (305-308). Reason:
#                 the pre-registered plateau rule picked t*=2 there, on an
#                 effective mass that rises from t=1 to t=2 (0.783(6) -> 0.804(12)),
#                 which a variational correlator cannot do in expectation.
#                 The replication is analysed alone and combined with round 1;
#                 all three numbers are reported.
#   d4_b2.4_L16   finite-volume check of d4_b2.4_L12 (16^4 instead of 16x12^3):
#                 string tension from a longer torelon, glueball on a larger box.
#   d4_b2.5_L16x  more statistics for d4_b2.5_L16 (new seeds 605-608), which had
#                 only 52 bins in round 1. Analysed combined with round 1.
#   d3_b6.0_L24   finite-volume check of d3_b6.0_L16 (24^3 instead of 16^3).
#
# Same code snapshot, update scheme, smearing and operators as round 1.
#
# Usage: ./run_extra_production.sh <code_dir> <out_dir> [time_scale]
set -u
CODE=${1:?code dir}; OUT=${2:?out dir}; SCALE=${3:-1.0}
mkdir -p "$OUT/logs"
export NUMBA_NUM_THREADS=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
export PYTHONPATH="$CODE"

# name | shape | beta | smearing levels | nskip | seconds per stream | nmeas cap | seed base
ENSEMBLES=(
  "d3_b9.0_L24r|24,24,24|9.0|5,15,30,45|2|840|30000|304"
  "d4_b2.4_L16|16,16,16,16|2.4|2,5,9,14,20|1|1500|15000|700"
  "d4_b2.5_L16x|16,16,16,16|2.5|4,10,18,28,40|1|1200|6000|604"
  "d3_b6.0_L24|24,24,24|6.0|2,6,12,18|1|300|80000|800"
)

run_slot () {
  local s=$1
  local start=hot; if (( s % 2 == 0 )); then start=cold; fi
  for e in "${ENSEMBLES[@]}"; do
    IFS='|' read -r name shape beta levels nskip secs cap base <<< "$e"
    local seed=$(( base + s ))
    local maxt; maxt=$(python3 -c "print(int($secs * $SCALE))")
    nice -n 10 python3 "$CODE/run_production.py" --shape "$shape" --beta "$beta" \
      --ntherm 1000 --nmeas "$cap" --nhb 1 --nor 4 --nskip "$nskip" \
      --levels "$levels" --w 0.25 --loops 1x1,2x2 --seed "$seed" --start "$start" \
      --maxtime "$maxt" --checkpoint 240 --progress 120 \
      --out "$OUT/${name}_s${seed}.npz" > "$OUT/logs/${name}_s${seed}.log" 2>&1
    echo "[slot $s] finished $name seed $seed (exit $?) at $(date -u +%H:%M:%S)"
  done
}

for s in 1 2 3 4; do run_slot "$s" & done
wait
echo "ALL EXTRA STREAMS DONE at $(date -u +%H:%M:%S)"
