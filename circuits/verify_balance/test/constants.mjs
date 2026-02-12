// Configurable constants for the integration test.
// All configuration is centralized here for easy modification.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainnet, sepolia } from 'viem/chains';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load .env if present (simple key=value parser, no dependency needed)
// ---------------------------------------------------------------------------
const envPath = resolve(__dirname, '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

// ---------------------------------------------------------------------------
// Directory paths
// ---------------------------------------------------------------------------
export const CIRCUIT_DIR = resolve(__dirname, '..');

// eth-proofs nargo cache path.
// Derived from Nargo.toml: git URL (without https://) + tag
// e.g. git = "https://github.com/lordshashank/eth-proofs", tag = "refactor/account-crate-visibility"
//   -> "github.com/lordshashank/eth-proofs/refactor/account-crate-visibility"
const ETH_PROOFS_NARGO_CACHE_PATH = 'github.com/lordshashank/eth-proofs/refactor/account-crate-visibility';
const YARN_BIN_FILENAME = 'yarn-4.2.1.cjs';

const NARGO_HOME = resolve(process.env.HOME, 'nargo');
export const ETH_PROOFS_DIR = resolve(NARGO_HOME, ETH_PROOFS_NARGO_CACHE_PATH);
export const ORACLE_DIR = resolve(ETH_PROOFS_DIR, 'ethereum/oracles');
export const YARN_BIN = resolve(ETH_PROOFS_DIR, '.yarn/releases', YARN_BIN_FILENAME);

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------
export const PRIVATE_KEY = process.env.PRIVATE_KEY;
export const CHAIN_ID = parseInt(process.env.CHAIN_ID || '11155111', 10);
export const PUBLIC_BALANCE_ETH = process.env.PUBLIC_BALANCE || '0.001';
export const NULLIFIER_BALANCE_ETH = process.env.NULLIFIER_BALANCE || PUBLIC_BALANCE_ETH;
export const BLOCK_NUMBER = process.env.BLOCK_NUMBER ? BigInt(process.env.BLOCK_NUMBER) : null;
export const PROVE_MODE = process.argv.includes('--prove');

// Build RPC URL: use explicit RPC_URL, or construct from ALCHEMY_API_KEY
let rpcUrl = process.env.RPC_URL;
if (!rpcUrl && process.env.ALCHEMY_API_KEY) {
  if (CHAIN_ID === 11155111) {
    rpcUrl = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  } else if (CHAIN_ID === 1) {
    rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  }
}
export const RPC_URL = rpcUrl;

// ---------------------------------------------------------------------------
// Chain config
// ---------------------------------------------------------------------------
export const CHAIN_MAP = {
  1: mainnet,
  11155111: sepolia,
};

// ---------------------------------------------------------------------------
// Binary names (expected on PATH)
// Install nargo: curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash && noirup
// Install bb:    curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/next/barretenberg/bbup/install | bash && bbup
// ---------------------------------------------------------------------------
export const NARGO_BIN = 'nargo';
export const BB_BIN = 'bb';
