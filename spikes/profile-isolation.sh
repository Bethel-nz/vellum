#!/bin/sh
# Spike 3: two profiles, two accounts, both stay logged in.
# Vellum never reads credentials; this only asks `claude` whether each dir is logged in.
#
#   sh spikes/profile-isolation.sh setup   # creates the two config dirs
#   CLAUDE_CONFIG_DIR=/tmp/vellum-profile-a claude   → /login as account A, then /exit
#   CLAUDE_CONFIG_DIR=/tmp/vellum-profile-b claude   → /login as account B, then /exit
#   sh spikes/profile-isolation.sh check   # both must answer, neither "Not logged in"
set -e
A=${A:-/tmp/vellum-profile-a}
B=${B:-/tmp/vellum-profile-b}
case "$1" in
  setup) mkdir -p "$A" "$B"; echo "created $A and $B" ;;
  check)
    for d in "$A" "$B"; do
      printf '%s: ' "$d"
      CLAUDE_CONFIG_DIR="$d" claude -p 'Reply with just: ok' --output-format json \
        | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("result"))'
    done ;;
  *) echo "usage: $0 setup|check" ;;
esac
