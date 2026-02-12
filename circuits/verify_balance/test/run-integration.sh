#!/usr/bin/env bash
set -euo pipefail

# Integration test runner for verify_balance circuit.
#
# Prerequisites:
#   - PRIVATE_KEY env var set to a funded Sepolia wallet
#   - ALCHEMY_API_KEY env var set (or configure RPC_URL)
#   - nargo: curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash && noirup
#   - bb (only for --prove): curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/next/barretenberg/bbup/install | bash && bbup
#
# Usage:
#   ./run-integration.sh              # Execute only (witness generation + constraint check)
#   ./run-integration.sh --prove      # Full end-to-end: execute + prove + verify
#
#   # Or with explicit config:
#   RPC_URL=https://eth-sepolia.g.alchemy.com/v2/KEY \
#   CHAIN_ID=11155111 \
#   PRIVATE_KEY=0x... \
#   PUBLIC_BALANCE=0.001 \
#   ./run-integration.sh --prove
#
#   # Or configure via .env file (copy .env.example to .env)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Install test dependencies if needed
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "[run-integration] Installing test dependencies..."
  (cd "$SCRIPT_DIR" && npm install)
fi

# Ensure nargo fetches dependencies (including eth-proofs oracle server)
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"
nargo check --silence-warnings 2>/dev/null || true

# Default to Sepolia
export CHAIN_ID="${CHAIN_ID:-11155111}"

# Run the integration test
exec node "$SCRIPT_DIR/integration.mjs" "$@"
