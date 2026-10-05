#!/usr/bin/env bash
# Runs a command. If it fails, puts its last 40 output lines on the run's
# summary page as one error (GitHub otherwise only says "exit code 1" there
# and hides the reason inside the step log). Usage:
#   report-failure.sh "<step title>" <command> [args...]
set -o pipefail
title="$1"
shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -eq 0 ]; then exit 0; fi
# Annotation text: no colour codes; %, CR and LF encoded as GitHub expects.
message="$(tail -n 40 "$log" | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's/%/%25/g' -e 's/\r/%0D/g' | awk 'BEGIN { ORS = "%0A" } { print }')"
echo "::error title=${title} failed::${message}"
exit "$status"
