// Fetches all Ethereum data needed for the sharded balance circuits.
// Replaces the oracle server entirely -- all data is pre-fetched and passed as circuit inputs.

import { createPublicClient, http, toHex, toRlp, hexToBytes, keccak256, toBytes } from 'viem';

// Convert a block object to an array of header fields suitable for RLP encoding.
function blockToHeaderFields(block) {
  const fields = [
    block.parentHash,
    block.sha3Uncles,
    block.miner,
    block.stateRoot,
    block.transactionsRoot,
    block.receiptsRoot,
    block.logsBloom,
    toHex(block.difficulty ?? 0n),
    toHex(block.number),
    toHex(block.gasLimit),
    toHex(block.gasUsed),
    toHex(block.timestamp),
    block.extraData,
    block.mixHash,
    block.nonce,
  ];
  if (block.baseFeePerGas != null) fields.push(toHex(block.baseFeePerGas));
  if (block.withdrawalsRoot) fields.push(block.withdrawalsRoot);
  if (block.blobGasUsed != null) fields.push(toHex(block.blobGasUsed));
  if (block.excessBlobGas != null) fields.push(toHex(block.excessBlobGas));
  if (block.parentBeaconBlockRoot) fields.push(block.parentBeaconBlockRoot);
  if (block.requestsHash) fields.push(block.requestsHash);
  return fields;
}

/**
 * Fetch all data needed for the sharded balance circuits.
 *
 * @param {string} rpcUrl - The JSON-RPC URL
 * @param {string} address - The Ethereum address (0x-prefixed)
 * @param {bigint} blockNumber - The block number to prove against
 * @returns {object} All data needed for circuits B1-B4
 */
export async function fetchProofData(rpcUrl, address, blockNumber) {
  const client = createPublicClient({ transport: http(rpcUrl) });

  // Fetch block header
  const block = await client.getBlock({ blockNumber });
  const headerFields = blockToHeaderFields(block);
  const headerRlpHex = toRlp(headerFields);
  const headerRlpBytes = hexToBytes(headerRlpHex);

  // Fetch account proof
  const proof = await client.getProof({ address, storageKeys: [], blockNumber });

  // Parse MPT proof nodes
  const proofNodes = proof.accountProof.map(hex => hexToBytes(hex));
  const internalNodes = proofNodes.slice(0, -1); // all except leaf
  const leaf = proofNodes[proofNodes.length - 1];
  const depth = proofNodes.length; // total including leaf

  // Build account RLP value (left-padded to MAX_ACCOUNT_STATE_LEN=110)
  const accountRlpHex = toRlp([
    proof.nonce === 0n ? '0x' : toHex(proof.nonce),
    proof.balance === 0n ? '0x' : toHex(proof.balance),
    proof.storageHash,
    proof.codeHash,
  ]);
  const accountRlpBytes = hexToBytes(accountRlpHex);

  return {
    header: {
      rlpBytes: headerRlpBytes,
      rlpLen: headerRlpBytes.length,
      stateRoot: hexToBytes(block.stateRoot),
    },
    account: {
      nonce: proof.nonce,
      balance: proof.balance,
      storageHash: hexToBytes(proof.storageHash),
      codeHash: hexToBytes(proof.codeHash),
      rlpBytes: accountRlpBytes,
    },
    mpt: {
      internalNodes,
      leaf,
      depth,
    },
    addressHash: hexToBytes(keccak256(address)),
  };
}
