#!/usr/bin/env bash
# Run after `forge build` — extracts ABI into packages/sdk/src/contracts/
set -e

OUT="$(dirname "$0")/../out/SpectreRegistry.sol/SpectreRegistry.json"
DEST="$(dirname "$0")/../../packages/sdk/src/contracts/SpectreRegistry.abi.json"

if [ ! -f "$OUT" ]; then
  echo "Run 'forge build' first"
  exit 1
fi

jq '.abi' "$OUT" > "$DEST"
echo "ABI exported to $DEST"
