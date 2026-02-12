// Utility functions for the integration test.

import { parseEther } from 'viem';
import { spawn } from 'node:child_process';
import { CHAIN_MAP } from './constants.mjs';

export function ethToWei(ethStr) {
  return parseEther(ethStr);
}

export function toU8Array(bytes) {
  return Array.from(bytes);
}

export function formatProverArray(arr) {
  return `[${arr.join(', ')}]`;
}

export function log(msg) {
  console.log(`[integration] ${msg}`);
}

export function logError(msg) {
  console.error(`[integration] ERROR: ${msg}`);
}

export function getChain(chainId) {
  if (CHAIN_MAP[chainId]) return CHAIN_MAP[chainId];
  console.error(`ERROR: Unsupported chain ID ${chainId}. Use 1 (mainnet) or 11155111 (Sepolia).`);
  process.exit(1);
}

export function runCommand(cmd, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    log(`Running: ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, NARGO_FOREIGN_CALL_TIMEOUT: '120000' },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} ${args[0]} exited with code ${code}`));
    });
  });
}
