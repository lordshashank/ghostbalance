// Configurable constants for the sharded circuit integration test.
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
export const CIRCUIT_A_DIR = resolve(__dirname, '..', 'identity_nullifier');
export const CIRCUIT_B1_DIR = resolve(__dirname, '..', 'balance_header');
export const CIRCUIT_B2_DIR = resolve(__dirname, '..', 'balance_mpt_step');
export const CIRCUIT_B4_DIR = resolve(__dirname, '..', 'balance_final');


// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------
export const PRIVATE_KEY = process.env.PRIVATE_KEY;
export const CHAIN_ID = parseInt(process.env.CHAIN_ID || '11155111', 10);
export const PUBLIC_BALANCE_ETH = process.env.PUBLIC_BALANCE || '0.001';
export const NULLIFIER_SEED_ETH = process.env.NULLIFIER_SEED || PUBLIC_BALANCE_ETH;
export const BLOCK_NUMBER = process.env.BLOCK_NUMBER ? BigInt(process.env.BLOCK_NUMBER) : null;
export const PROVE_MODE = process.argv.includes('--prove');

// Fixed blinding factor for test reproducibility
export const BLINDING = process.env.BLINDING || '12345';

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
// ---------------------------------------------------------------------------
export const NARGO_BIN = 'nargo';
export const BB_BIN = 'bb';
