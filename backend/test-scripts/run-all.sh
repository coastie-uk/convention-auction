#!/bin/bash
set -euo pipefail

runs="${1:-${RUNS:-1}}"
delay="${2:-${DELAY_SECONDS:-0}}"
if ! [[ "$runs" =~ ^[0-9]+$ ]] || [ "$runs" -lt 1 ]; then
  echo "Usage: $0 [runs] (runs must be a positive integer)" >&2
  exit 2
fi
if ! [[ "$delay" =~ ^[0-9]+$ ]] || [ "$delay" -lt 0 ]; then
  echo "Usage: $0 [runs] [delay_seconds] (delay_seconds must be a non-negative integer)" >&2
  exit 2
fi

scripts=(
  backend-tests.js
  bid_payment-tests.js
  maintenance-tests.js
)

declare -A passed=()
declare -A failed=()

for ((i = 1; i <= runs; i++)); do
  run_passed=0
  run_failed=0
  for idx in "${!scripts[@]}"; do
    script="${scripts[$idx]}"
    echo "Run $i: running $script"
    if node "$script" -s; then
      : "${passed[$script]:=0}"
      ((++passed["$script"]))
      ((++run_passed))
    else
      : "${failed[$script]:=0}"
      ((++failed["$script"]))
      ((++run_failed))
    fi
    if [ "$delay" -gt 0 ] && [ "$idx" -lt $((${#scripts[@]} - 1)) ]; then
      sleep "$delay"
    fi
  done
  echo "Run $i: $run_passed passed, $run_failed failed"
done

echo "Summary (${runs} run(s) each):"
for script in "${scripts[@]}"; do
  p="${passed[$script]:-0}"
  f="${failed[$script]:-0}"
  t=$((p + f))
  echo "  $script: $p passed, $f failed (total $t)"
done
