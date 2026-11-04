#!/usr/bin/env bash
# The clean-clone test on Linux (WSL Ubuntu or any Linux): a fresh clone of this repo on the
# Linux filesystem, with no .env and no .near-credentials, runs README steps 1-5 and every keyless
# command in the README table. Each step prints PASS or FAIL; the exit code is the number of
# failures. The clone is deleted afterwards (KEEP=1 keeps it). Needs Node 24 and Rust with
# cargo-near; a Node in ~/.local/node is used first (AGENTS.md).
set -uo pipefail
# The clone is of HEAD: commit first, or the clone tests the previous commit.
SRC=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$HOME/.local/node/bin" ] && export PATH="$HOME/.local/node/bin:$PATH"
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
CLONE=${CLONE:-$HOME/dayone-clean-clone}
LOGS=$(mktemp -d)
rm -rf "$CLONE"
git clone -q "$SRC" "$CLONE" || exit 1
cd "$CLONE"
echo "commit $(git rev-parse --short HEAD), node $(node --version), $(uname -sr)"

fails=0
report() { # name, ok (0/1)
  if [ "$2" -eq 0 ]; then echo "PASS $1"; else echo "FAIL $1"; tail -20 "$LOGS/$1"; fails=$((fails + 1)); fi
}
run() { # name, command...
  local name=$1; shift
  "$@" >"$LOGS/$name" 2>&1; report "$name" $?
}
expect() { # name, text the output must contain, command...
  local name=$1 text=$2; shift 2
  "$@" >"$LOGS/$name" 2>&1 && grep -qF -- "$text" "$LOGS/$name"; report "$name" $?
}

if ls -a | grep -qE '^\.env$|near-credentials'; then echo "FAIL secrets in the clone"; fails=$((fails + 1)); fi
run npm-ci npm ci
expect demo "Transcript matches data/replay/transcript.txt." npm run demo
expect verify "MATCH  BR-B-1045" npm run verify -- data/batch-records/BR-B-1045.json
# Step 4: one more gram on the first actual_mg must give MISMATCH and exit 1.
node -e 'const fs=require("fs");const s=fs.readFileSync(process.argv[1],"utf8");const t=s.replace(/"actual_mg":\s*(\d+)/,(m,n)=>`"actual_mg": ${Number(n)+1000}`);if(t===s)process.exit(2);fs.writeFileSync(process.argv[2],t)' \
  data/batch-records/BR-B-1045.json "$LOGS/tampered.json"
npm run verify -- "$LOGS/tampered.json" >"$LOGS/tamper" 2>&1
[ $? -eq 1 ] && grep -q MISMATCH "$LOGS/tamper"; report tamper $?

expect test-attacks "21 of 21 attacks failed against Kevin." npm run test:attacks
run escrow npm run escrow
expect verify-attestation "Every check verified." npm run verify:attestation
expect erp-reconcile "7 of 7 checks match." npm run erp:reconcile
expect demo-group "Transcript matches" npm run demo:group
expect usdc "Transcript matches data/usdc/transcript.txt." npm run usdc
expect sealed "Transcript matches data/sealed/transcript.txt." npm run sealed
run books npm run books
run brief npm run brief
run import npm run import -- "data/imports/INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx"
expect inbox "4 of 4 scans landed" npm run inbox
expect verify-round "VALID" npm run verify:round -- data/sealed/RFQ-2611-02.round.json
expect lots "every root matches its records and the genealogy." npm run lots
expect verify-lot "3 of 3 records proved against the roots anchored on chain." npm run verify:lot -- ASC-261116-01
run web-build npm run web:build
run web-data-check npm run web:data -- --check
expect repo-check "The repo is ready to freeze." npm run repo:check
run check npm run check
grep -E "Tests" "$LOGS/check" | tail -1
expect cargo-test "test result: ok" bash -c 'cd contracts && cargo test'
grep -E "^test result" "$LOGS/cargo-test"

dirty=$(git status --porcelain)
[ -z "$dirty" ]; report "clone stays clean" $?
[ -n "$dirty" ] && echo "$dirty"
echo "failures: $fails"
cd "$HOME"
[ "${KEEP:-0}" = 1 ] || rm -rf "$CLONE" "$LOGS"
exit "$fails"
