#!/usr/bin/env bash
# Compiles all Noir circuits and copies artifacts to the frontend public dir.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUITS_DIR="$REPO_ROOT/packages/circuits"
FRONTEND_CIRCUITS="$REPO_ROOT/packages/frontend/public/circuits"
BACKEND_CIRCUITS="$REPO_ROOT/packages/backend/circuits"

export PATH="$HOME/.nargo/bin:$PATH"

mkdir -p "$FRONTEND_CIRCUITS" "$BACKEND_CIRCUITS"

for circuit in identity_nullifier balance_header balance_mpt_step balance_final; do
  echo "==> Compiling $circuit..."
  (cd "$CIRCUITS_DIR/$circuit" && nargo compile --silence-warnings)
  cp "$CIRCUITS_DIR/$circuit/target/$circuit.json" "$FRONTEND_CIRCUITS/"
  cp "$CIRCUITS_DIR/$circuit/target/$circuit.json" "$BACKEND_CIRCUITS/"
  echo "    Copied $circuit.json to frontend + backend"
done

echo "==> All circuits compiled and copied."
