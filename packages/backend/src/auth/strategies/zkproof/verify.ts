import { readFileSync } from "fs";
import { join } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProofBundle {
  proofA: number[];
  publicInputsA: string[];
  proofB1: number[];
  publicInputsB1: string[];
  proofB2: number[];
  publicInputsB2: string[];
  proofB3: number[];
  publicInputsB3: string[];
  proofB4: number[];
  publicInputsB4: string[];
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
  nullifier?: string;
  blockNumber?: number;
  publicBalance?: string;
  blockHash?: string;
}

export interface VerificationConfig {
  circuitDir: string;
  ethRpcUrl: string;
  maxBlockAge: number;
}

// ── Bytecode loading (cached) ────────────────────────────────────────────────

const bytecodeCache = new Map<string, string>();

function loadBytecode(circuitDir: string, name: string): string {
  const key = `${circuitDir}:${name}`;
  const cached = bytecodeCache.get(key);
  if (cached) return cached;

  const filePath = join(circuitDir, `${name}.json`);
  const circuit = JSON.parse(readFileSync(filePath, "utf-8"));
  const bytecode = circuit.bytecode as string;
  bytecodeCache.set(key, bytecode);
  return bytecode;
}

function loadAllBytecodes(circuitDir: string) {
  return {
    A: loadBytecode(circuitDir, "identity_nullifier"),
    B1: loadBytecode(circuitDir, "balance_header"),
    B2: loadBytecode(circuitDir, "balance_mpt_step"),
    B4: loadBytecode(circuitDir, "balance_final"),
  };
}

// ── Public input decoders ────────────────────────────────────────────────────

// Circuit A: [commitment, nullifier]
function decodePublicInputsA(publicInputs: string[]) {
  return {
    commitment: publicInputs[0],
    nullifier: publicInputs[1],
  };
}

// Circuit B1: [block_number, commitment_in, block_hash[0..31], link_out]
// Total: 2 + 32 + 1 = 35 fields
function decodePublicInputsB1(publicInputs: string[]) {
  const blockNumber = Number(BigInt(publicInputs[0]));
  const commitmentIn = publicInputs[1];

  const blockHashBytes = publicInputs.slice(2, 34).map((v) => {
    const n = Number(BigInt(v));
    return n.toString(16).padStart(2, "0");
  });
  const blockHash = "0x" + blockHashBytes.join("");

  const linkOut = publicInputs[34];

  return { blockNumber, commitmentIn, blockHash, linkOut };
}

// Circuit B2/B3: [link_in, link_out]
function decodePublicInputsB2B3(publicInputs: string[]) {
  return {
    linkIn: publicInputs[0],
    linkOut: publicInputs[1],
  };
}

// Circuit B4: [link_in, public_balance]
function decodePublicInputsB4(publicInputs: string[]) {
  return {
    linkIn: publicInputs[0],
    publicBalance: BigInt(publicInputs[1]).toString(),
  };
}

// ── Link chain validation ────────────────────────────────────────────────────

export function validateLinkChain(bundle: ProofBundle): {
  valid: boolean;
  error?: string;
  decoded?: {
    commitment: string;
    nullifier: string;
    blockNumber: number;
    blockHash: string;
    publicBalance: string;
  };
} {
  const decodedA = decodePublicInputsA(bundle.publicInputsA);
  const decodedB1 = decodePublicInputsB1(bundle.publicInputsB1);
  const decodedB2 = decodePublicInputsB2B3(bundle.publicInputsB2);
  const decodedB3 = decodePublicInputsB2B3(bundle.publicInputsB3);
  const decodedB4 = decodePublicInputsB4(bundle.publicInputsB4);

  // A.commitment == B1.commitment_in
  if (decodedA.commitment !== decodedB1.commitmentIn) {
    return { valid: false, error: "Commitment mismatch: A.commitment != B1.commitment_in" };
  }

  // B1.link_out == B2.link_in
  if (decodedB1.linkOut !== decodedB2.linkIn) {
    return { valid: false, error: "Link mismatch: B1.link_out != B2.link_in" };
  }

  // B2.link_out == B3.link_in
  if (decodedB2.linkOut !== decodedB3.linkIn) {
    return { valid: false, error: "Link mismatch: B2.link_out != B3.link_in" };
  }

  // B3.link_out == B4.link_in
  if (decodedB3.linkOut !== decodedB4.linkIn) {
    return { valid: false, error: "Link mismatch: B3.link_out != B4.link_in" };
  }

  return {
    valid: true,
    decoded: {
      commitment: decodedA.commitment,
      nullifier: decodedA.nullifier,
      blockNumber: decodedB1.blockNumber,
      blockHash: decodedB1.blockHash,
      publicBalance: decodedB4.publicBalance,
    },
  };
}

// ── Cryptographic proof verification ─────────────────────────────────────────

async function verifyAllProofs(
  bundle: ProofBundle,
  bytecodes: ReturnType<typeof loadAllBytecodes>
): Promise<{ valid: boolean; error?: string }> {
  const { UltraHonkBackend } = await import("@aztec/bb.js");

  const proofs = [
    { name: "A", bytecode: bytecodes.A, proof: bundle.proofA, publicInputs: bundle.publicInputsA },
    { name: "B1", bytecode: bytecodes.B1, proof: bundle.proofB1, publicInputs: bundle.publicInputsB1 },
    { name: "B2", bytecode: bytecodes.B2, proof: bundle.proofB2, publicInputs: bundle.publicInputsB2 },
    { name: "B3", bytecode: bytecodes.B2, proof: bundle.proofB3, publicInputs: bundle.publicInputsB3 },
    { name: "B4", bytecode: bytecodes.B4, proof: bundle.proofB4, publicInputs: bundle.publicInputsB4 },
  ];

  for (const p of proofs) {
    const backend = new UltraHonkBackend(p.bytecode);
    let valid: boolean;
    try {
      valid = await backend.verifyProof({
        proof: new Uint8Array(p.proof),
        publicInputs: p.publicInputs,
      });
    } catch (err) {
      await backend.destroy();
      return { valid: false, error: `Proof ${p.name} verification error: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      await backend.destroy();
    }
    if (!valid) {
      return { valid: false, error: `Proof ${p.name} verification failed` };
    }
  }

  return { valid: true };
}

// ── On-chain checks ──────────────────────────────────────────────────────────

async function ethRpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
  retries = 3
): Promise<unknown> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        throw new Error(`ETH RPC HTTP error: ${res.status}`);
      }
      const json = (await res.json()) as { result?: unknown; error?: { message: string } };
      if (json.error) {
        throw new Error(`ETH RPC error: ${json.error.message}`);
      }
      return json.result;
    } catch (err) {
      if (attempt === retries) throw err;
    }
  }
  throw new Error("ETH RPC call failed after retries");
}

export async function checkBlockFreshness(
  blockNumber: number,
  ethRpcUrl: string,
  maxBlockAge: number
): Promise<{ valid: boolean; error?: string; currentBlock?: number }> {
  const result = await ethRpcCall(ethRpcUrl, "eth_blockNumber", []);
  const currentBlock = Number(BigInt(result as string));

  if (currentBlock - blockNumber > maxBlockAge) {
    return {
      valid: false,
      error: `Block ${blockNumber} is too old (current: ${currentBlock}, max age: ${maxBlockAge})`,
      currentBlock,
    };
  }

  return { valid: true, currentBlock };
}

export async function verifyBlockHash(
  blockNumber: number,
  expectedBlockHash: string,
  ethRpcUrl: string
): Promise<{ valid: boolean; error?: string }> {
  const hexBlockNumber = "0x" + blockNumber.toString(16);
  const result = await ethRpcCall(ethRpcUrl, "eth_getBlockByNumber", [hexBlockNumber, false]);

  if (!result) {
    return { valid: false, error: `Block ${blockNumber} not found on chain` };
  }

  const block = result as { hash: string };
  if (block.hash.toLowerCase() !== expectedBlockHash.toLowerCase()) {
    return {
      valid: false,
      error: `Block hash mismatch: expected ${expectedBlockHash}, got ${block.hash}`,
    };
  }

  return { valid: true };
}

// ── Main orchestrator ────────────────────────────────────────────────────────

export async function verifyProofBundle(
  bundle: ProofBundle,
  config: VerificationConfig,
  options: { checkFreshness?: boolean } = {}
): Promise<VerificationResult> {
  const { checkFreshness: shouldCheckFreshness = true } = options;

  // 1. Validate link chain (fast, no I/O)
  const linkResult = validateLinkChain(bundle);
  if (!linkResult.valid) {
    return { valid: false, error: linkResult.error };
  }
  const { nullifier, blockNumber, blockHash, publicBalance } = linkResult.decoded!;

  // 2. On-chain checks (before CPU-heavy proof verification to avoid event loop starvation)
  const hashResult = await verifyBlockHash(blockNumber, blockHash, config.ethRpcUrl);
  if (!hashResult.valid) {
    return { valid: false, error: hashResult.error };
  }

  if (shouldCheckFreshness) {
    const freshnessResult = await checkBlockFreshness(blockNumber, config.ethRpcUrl, config.maxBlockAge);
    if (!freshnessResult.valid) {
      return { valid: false, error: freshnessResult.error };
    }
  }

  // 3. Verify all 5 proofs cryptographically
  const bytecodes = loadAllBytecodes(config.circuitDir);
  const proofResult = await verifyAllProofs(bundle, bytecodes);
  if (!proofResult.valid) {
    return { valid: false, error: proofResult.error };
  }

  return {
    valid: true,
    nullifier,
    blockNumber,
    publicBalance,
    blockHash,
  };
}
