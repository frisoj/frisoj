#!/usr/bin/env bash
# Production ensembles for the SU(2) lattice Yang-Mills mass-gap study.
# Numerical evidence at finite lattice spacing and volume -- NOT a proof.
#
# Usage: ./run_all_production.sh <code_dir> <out_dir> [time_scale]
#   code_dir   directory containing ym/ and run_production.py (a frozen snapshot)
#   out_dir    where the raw .npz files and logs go
#   time_scale multiplies every per-stream wall-clock budget (default 1.0)
#
# 4 independent streams (one per CPU core); streams 1,3 start hot, 2,4 start cold.
# Every stream runs the six ensembles one after the other, each with a fixed
# wall-clock budget (--maxtime), so the number of measurements is whatever fits.
set -u
CODE=${1:?code dir}; OUT=${2:?out dir}; SCALE=${3:-1.0}
mkdir -p "$OUT/logs"
export NUMBA_NUM_THREADS=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
export PYTHONPATH="$CODE"

# name | shape | beta | smearing levels | nskip | seconds per stream | nmeas cap | ensemble id
ENSEMBLES=(
  "d3_b6.0_L16|16,16,16|6.0|2,6,12,18|1|360|80000|1"
  "d4_b2.3_L10|12,10,10,10|2.3|2,4,6,10,14|1|780|30000|2"
  "d3_b9.0_L24|24,24,24|9.0|5,15,30,45|2|840|30000|3"
  "d4_b2.4_L12|16,12,12,12|2.4|2,5,9,14,20|1|1140|15000|4"
  "d3_b12.0_L32|32,32,32|12.0|10,25,50,80|3|1080|10000|5"
  "d4_b2.5_L16|16,16,16,16|2.5|4,10,18,28,40|1|1200|6000|6"
)

run_slot () {
  local s=$1
  local start=hot; if (( s % 2 == 0 )); then start=cold; fi
  for e in "${ENSEMBLES[@]}"; do
    IFS='|' read -r name shape beta levels nskip secs cap eid <<< "$e"
    local seed=$(( 100 * eid + s ))
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
echo "ALL PRODUCTION STREAMS DONE at $(date -u +%H:%M:%S)"
