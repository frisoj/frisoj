#!/usr/bin/env bash
# Third round of runs for the SU(2) lattice Yang-Mills mass-gap study.
# Numerical evidence at finite lattice spacing and volume -- NOT a proof.
#
# This run was decided AFTER the adversarial physics review of rounds 1 and 2
# and BEFORE any of its own data existed (this file was committed first).
#
# Why. The review found that for the three pre-registered D=4 ensembles the
# product a*m*L is constant within errors (11.95(22), 11.91(18), 11.87(35) at
# beta = 2.3, 2.4, 2.5), which is what a pure finite-size gap m ~ 1/L would
# give. That reading is excluded so far by ONE larger-volume run, at beta = 2.4
# only (d4_b2.4_L16). At beta = 2.5, the finest D=4 lattice and the smallest
# physical box (L*a*sqrt(sigma) = 3.0), there is no second volume, and an
# exploratory test found a torelon-pair level close to the glueball there.
#
#   d4_b2.5_L20   finite-volume check of d4_b2.5_L16: 20^4 instead of 16^4,
#                 new seeds 901-904, otherwise identical parameters.
#                 L*a*sqrt(sigma) becomes about 3.7, close to the beta = 2.3 box.
#
# Fixed before the data exist:
#   Primary quantity: the fixed-t effective mass m_eff(1) of the 0++ glueball
#     from the unchanged pipeline (analyze.py, rules R1-R8), jackknife error.
#     m_eff(2) and the R5 plateau value are reported beside it.
#   Reference: d4_b2.5_L16_combined, a*m_eff(1) = 0.7531(170).
#   Reading A, pure finite-size gap (m ~ 1/L): predicts 0.7531 * 16/20 = 0.6025(136).
#   Reading B, volume-independent gap: predicts 0.7531(170), or a few percent
#     less if the L=16 value is raised by the nearby torelon-pair level
#     (exploratory value with that operator included: 0.7392(163)).
#   Published values seen in search results (not opened): 0.660(22), 0.6857(28), 0.72(3).
#   Criterion: reading A counts as excluded at beta = 2.5 if the measured value
#     lies more than 3 sigma (errors added in quadrature) above 0.6025, and as
#     NOT excluded otherwise. If the measured value lies more than 3 sigma below
#     0.7531, the L=16 value is reported as volume-contaminated.
#   The string tension from the L=20 torelon (same rules) is compared with the
#     L=16 value a*sqrt(sigma) = 0.1866(11).
#   The outcome is reported whatever it is; the L=16 numbers stay in the report.
#
# Same code snapshot, update scheme, smearing and operators as rounds 1 and 2.
# Re-running this script continues interrupted streams (--resume).
#
# Usage: ./run_round3_production.sh <code_dir> <out_dir>
set -u
CODE=${1:?code dir}; OUT=${2:?out dir}
mkdir -p "$OUT/logs"
export NUMBA_NUM_THREADS=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
export PYTHONPATH="$CODE"

# name | shape | beta | smearing levels | nskip | max seconds per stream | nmeas cap | seed base
ENSEMBLES=(
  "d4_b2.5_L20|20,20,20,20|2.5|4,10,18,28,40|1|6600|2400|900"
)

run_slot () {
  local s=$1
  local start=hot; if (( s % 2 == 0 )); then start=cold; fi
  for e in "${ENSEMBLES[@]}"; do
    IFS='|' read -r name shape beta levels nskip secs cap base <<< "$e"
    local seed=$(( base + s ))
    local out="$OUT/${name}_s${seed}.npz"
    local resume=""; if [[ -f "$out" ]]; then resume="--resume"; fi
    nice -n 10 python3 "$CODE/run_production.py" --shape "$shape" --beta "$beta" \
      --ntherm 1000 --nmeas "$cap" --nhb 1 --nor 4 --nskip "$nskip" \
      --levels "$levels" --w 0.25 --loops 1x1,2x2 --seed "$seed" --start "$start" \
      --maxtime "$secs" --checkpoint 240 --progress 120 $resume \
      --out "$out" >> "$OUT/logs/${name}_s${seed}.log" 2>&1
    echo "[slot $s] finished $name seed $seed (exit $?) at $(date -u +%H:%M:%S)"
  done
}

for s in 1 2 3 4; do run_slot "$s" & done
wait
echo "ALL ROUND-3 STREAMS DONE at $(date -u +%H:%M:%S)"
