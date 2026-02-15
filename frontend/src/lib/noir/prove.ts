import { Noir } from "@noir-lang/noir_js";
import type { CompiledCircuit, InputMap } from "@noir-lang/types";
import { UltraHonkBackend } from "@aztec/bb.js";
import type { ProofData } from "@aztec/bb.js";
import { patchCrsFetch } from "./crsProxy";
import { replayMptPath, padNode, padLeaf, leftPad } from "./mptReplay";
import type { ProofData as EthProofData } from "./fetchProofData";

// ---- Input types ----

export interface CircuitAInputs {
  nullifier_balance: string;
  signature: string[];
  public_key_x: string[];
  public_key_y: string[];
  blinding: string;
  [key: string]: string | string[];
}

// ---- Result type ----

export interface ShardedProveResult {
  proofA: Uint8Array;
  publicInputsA: string[];
  proofB1: Uint8Array;
  publicInputsB1: string[];
  proofB2: Uint8Array;
  publicInputsB2: string[];
  proofB3: Uint8Array;
  publicInputsB3: string[];
  proofB4: Uint8Array;
  publicInputsB4: string[];
}

// ---- Circuit loading with cache ----

let circuitACache: CompiledCircuit | null = null;
let circuitB1Cache: CompiledCircuit | null = null;
let circuitB2Cache: CompiledCircuit | null = null;
let circuitB4Cache: CompiledCircuit | null = null;

async function loadCircuit(
  name: string,
  cache: { value: CompiledCircuit | null }
): Promise<CompiledCircuit> {
  if (cache.value) return cache.value;
  const resp = await fetch(`/circuits/${name}.json`);
  if (!resp.ok) throw new Error(`Failed to load ${name} circuit`);
  cache.value = (await resp.json()) as CompiledCircuit;
  return cache.value;
}

const cacheA = { get value() { return circuitACache; }, set value(v) { circuitACache = v; } };
const cacheB1 = { get value() { return circuitB1Cache; }, set value(v) { circuitB1Cache = v; } };
const cacheB2 = { get value() { return circuitB2Cache; }, set value(v) { circuitB2Cache = v; } };
const cacheB4 = { get value() { return circuitB4Cache; }, set value(v) { circuitB4Cache = v; } };

// ---- Constants matching circuit definitions ----

const MAX_HEADER_RLP_LEN = 708;
const MAX_NODE_LEN = 532;
const MAX_ACCOUNT_LEAF_LEN = 148;
const MAX_ACCOUNT_STATE_LEN = 110;

// ---- Helpers ----

/** Convert Uint8Array to array of hex byte strings for noir_js */
function toByteStrings(bytes: Uint8Array): string[] {
  return Array.from(bytes).map((b) => "0x" + b.toString(16).padStart(2, "0"));
}

/** Right-pad a Uint8Array to targetLen */
function rightPadBytes(bytes: Uint8Array, targetLen: number): Uint8Array {
  const padded = new Uint8Array(targetLen);
  padded.set(bytes.slice(0, Math.min(bytes.length, targetLen)));
  return padded;
}

/** Parse a return value field flexibly (could be string or nested) */
function parseReturnField(val: unknown): string {
  if (typeof val === "string") return val;
  if (typeof val === "bigint") return "0x" + val.toString(16);
  throw new Error(`Unexpected return value type: ${typeof val}`);
}

/** Parse a return value that is a Bytes32 (array of 32 byte values) */
function parseReturnBytes32(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((v) => {
      if (typeof v === "string") return v;
      if (typeof v === "bigint") return "0x" + v.toString(16).padStart(2, "0");
      return String(v);
    });
  }
  throw new Error(`Expected array for Bytes32, got ${typeof val}`);
}

// ---- Main proving function ----

export async function generateShardedProof(
  inputsA: CircuitAInputs,
  proofData: EthProofData,
  blockNumber: bigint,
  publicBalance: bigint,
  nullifierBalance: bigint,
  blinding: string,
  address: string[],
  onStatus?: (status: string) => void
): Promise<ShardedProveResult> {
  const totalStart = performance.now();

  // Load all 4 circuits up front (B2 is reused for B3)
  onStatus?.("[1/12] Loading circuits...");
  const [circuitA, circuitB1, circuitB2, circuitB4] = await Promise.all([
    loadCircuit("identity_nullifier", cacheA),
    loadCircuit("balance_header", cacheB1),
    loadCircuit("balance_mpt_step", cacheB2),
    loadCircuit("balance_final", cacheB4),
  ]);
  console.log("[prove] All 4 circuits loaded");

  // ===========================================================================
  // EXECUTION PHASE: Sequential execute, chaining returnValues
  // ===========================================================================

  // --- Execute Circuit A ---
  onStatus?.("[2/12] Executing Circuit A (identity + nullifier)...");
  const noirA = new Noir(circuitA);
  let t0 = performance.now();
  const resultA = await noirA.execute(inputsA);
  console.log(`[prove:A] Execute: ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  // returnValue: (Field, Field) -> [commitment, nullifier] or {0: ..., 1: ...}
  const retA = resultA.returnValue;
  console.log("[prove:A] returnValue:", JSON.stringify(retA));
  let commitment: string;
  let nullifier: string;
  if (Array.isArray(retA)) {
    commitment = parseReturnField(retA[0]);
    nullifier = parseReturnField(retA[1]);
  } else if (retA && typeof retA === "object") {
    const obj = retA as Record<string, unknown>;
    commitment = parseReturnField(obj["0"] ?? obj["commitment"]);
    nullifier = parseReturnField(obj["1"] ?? obj["nullifier"]);
  } else {
    throw new Error(`Unexpected Circuit A returnValue: ${JSON.stringify(retA)}`);
  }
  console.log(`[prove:A] commitment=${commitment}, nullifier=${nullifier}`);

  // --- Execute Circuit B1 ---
  onStatus?.("[3/12] Executing Circuit B1 (balance header)...");

  const headerRlpPadded = rightPadBytes(proofData.header.rlpBytes, MAX_HEADER_RLP_LEN);
  const stateRootBytes = toByteStrings(proofData.header.stateRoot);

  const inputsB1: InputMap = {
    block_number: blockNumber.toString(),
    commitment_in: commitment,
    address,
    nullifier_balance: nullifierBalance.toString(),
    blinding,
    header_rlp: toByteStrings(headerRlpPadded),
    header_rlp_len: proofData.header.rlpLen.toString(),
    header_state_root: stateRootBytes,
  };

  const noirB1 = new Noir(circuitB1);
  t0 = performance.now();
  const resultB1 = await noirB1.execute(inputsB1);
  console.log(`[prove:B1] Execute: ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  // returnValue: (Bytes32, Field) -> [block_hash_bytes, link_out]
  const retB1 = resultB1.returnValue;
  console.log("[prove:B1] returnValue type:", typeof retB1, Array.isArray(retB1) ? `len=${(retB1 as unknown[]).length}` : "");

  let linkOut1: string;
  if (Array.isArray(retB1)) {
    // [Bytes32, Field] -> second element is link_out
    linkOut1 = parseReturnField(retB1[1]);
  } else if (retB1 && typeof retB1 === "object") {
    const obj = retB1 as Record<string, unknown>;
    linkOut1 = parseReturnField(obj["1"] ?? obj["link_out"]);
  } else {
    throw new Error(`Unexpected B1 returnValue: ${JSON.stringify(retB1)}`);
  }
  console.log(`[prove:B1] link_out=${linkOut1}`);

  // --- Execute Circuit B2 (MPT step, nodes 0-3) ---
  onStatus?.("[4/12] Executing Circuit B2 (MPT nodes 0-3)...");

  const { internalNodes, depth } = proofData.mpt;
  const addressHashBytes = toByteStrings(proofData.addressHash);
  const stateRootArr = proofData.header.stateRoot;

  // Prepare nodes 0-3 padded to 532 bytes
  const nodesB2: string[][] = [];
  for (let i = 0; i < 4; i++) {
    if (i < internalNodes.length) {
      nodesB2.push(toByteStrings(padNode(internalNodes[i], MAX_NODE_LEN)));
    } else {
      nodesB2.push(Array(MAX_NODE_LEN).fill("0x00"));
    }
  }

  const inputsB2: InputMap = {
    link_in: linkOut1,
    curr_hash: toByteStrings(stateRootArr),
    address_hash: addressHashBytes,
    key_ptr_in: "0",
    nullifier_balance: nullifierBalance.toString(),
    blinding,
    depth: depth.toString(),
    start_index: "0",
    nodes: nodesB2,
  };

  const noirB2 = new Noir(circuitB2);
  t0 = performance.now();
  const resultB2 = await noirB2.execute(inputsB2);
  console.log(`[prove:B2] Execute: ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  // returnValue: pub Field -> single value (link_out)
  const linkOut2 = parseReturnField(resultB2.returnValue);
  console.log(`[prove:B2] link_out=${linkOut2}`);

  // --- Execute Circuit B3 (MPT step, nodes 4-7) ---
  onStatus?.("[5/12] Executing Circuit B3 (MPT nodes 4-7)...");

  // Replay MPT path through nodes 0-3 to get intermediate state
  const afterB2 = replayMptPath(
    proofData.header.stateRoot,
    proofData.addressHash,
    internalNodes,
    0,
    Math.min(4, internalNodes.length)
  );
  console.log(`[prove:B3] After B2 replay: keyPtr=${afterB2.keyPtr}`);

  const nodesB3: string[][] = [];
  for (let i = 0; i < 4; i++) {
    const idx = 4 + i;
    if (idx < internalNodes.length) {
      nodesB3.push(toByteStrings(padNode(internalNodes[idx], MAX_NODE_LEN)));
    } else {
      nodesB3.push(Array(MAX_NODE_LEN).fill("0x00"));
    }
  }

  const inputsB3: InputMap = {
    link_in: linkOut2,
    curr_hash: toByteStrings(afterB2.currHash),
    address_hash: addressHashBytes,
    key_ptr_in: afterB2.keyPtr.toString(),
    nullifier_balance: nullifierBalance.toString(),
    blinding,
    depth: depth.toString(),
    start_index: "4",
    nodes: nodesB3,
  };

  // Reuse the same circuit (B2) for B3
  const noirB3 = new Noir(circuitB2);
  t0 = performance.now();
  const resultB3 = await noirB3.execute(inputsB3);
  console.log(`[prove:B3] Execute: ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  const linkOut3 = parseReturnField(resultB3.returnValue);
  console.log(`[prove:B3] link_out=${linkOut3}`);

  // --- Execute Circuit B4 (final: remaining nodes + leaf + account) ---
  onStatus?.("[6/12] Executing Circuit B4 (balance final)...");

  // Replay MPT path through nodes 0-7
  const afterB3 = replayMptPath(
    proofData.header.stateRoot,
    proofData.addressHash,
    internalNodes,
    0,
    Math.min(8, internalNodes.length)
  );
  console.log(`[prove:B4] After B3 replay: keyPtr=${afterB3.keyPtr}`);

  // Remaining internal nodes (indices 8-9)
  const nodesB4: string[][] = [];
  for (let i = 0; i < 2; i++) {
    const idx = 8 + i;
    if (idx < internalNodes.length) {
      nodesB4.push(toByteStrings(padNode(internalNodes[idx], MAX_NODE_LEN)));
    } else {
      nodesB4.push(Array(MAX_NODE_LEN).fill("0x00"));
    }
  }

  const leafPadded = padLeaf(proofData.mpt.leaf, MAX_ACCOUNT_LEAF_LEN);
  const accountValuePadded = leftPad(proofData.account.rlpBytes, MAX_ACCOUNT_STATE_LEN);

  const inputsB4: InputMap = {
    link_in: linkOut3,
    public_balance: publicBalance.toString(),
    curr_hash: toByteStrings(afterB3.currHash),
    address_hash: addressHashBytes,
    key_ptr_in: afterB3.keyPtr.toString(),
    nullifier_balance: nullifierBalance.toString(),
    blinding,
    depth: depth.toString(),
    nodes: nodesB4,
    leaf: toByteStrings(leafPadded),
    account_value: toByteStrings(accountValuePadded),
    account_nonce: proofData.account.nonce.toString(),
    account_balance: proofData.account.balance.toString(),
    account_storage_root: toByteStrings(proofData.account.storageHash),
    account_code_hash: toByteStrings(proofData.account.codeHash),
  };

  const noirB4 = new Noir(circuitB4);
  t0 = performance.now();
  const resultB4 = await noirB4.execute(inputsB4);
  console.log(`[prove:B4] Execute: ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  const executeTime = ((performance.now() - totalStart) / 1000).toFixed(1);
  console.log(`[prove] All 5 executions done in ${executeTime}s`);

  // ===========================================================================
  // PROVING PHASE: Sequential prove using witnesses from execution
  // ===========================================================================

  patchCrsFetch();

  // --- Prove Circuit A ---
  onStatus?.("[7/12] Proving Circuit A (identity)...");
  t0 = performance.now();
  const backendA = new UltraHonkBackend(circuitA.bytecode, { threads: 1 });
  let proofDataA: ProofData;
  try {
    proofDataA = await backendA.generateProof(resultA.witness);
  } finally {
    await backendA.destroy();
  }
  const timeA = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[prove:A] Proof: ${timeA}s, size=${proofDataA.proof.length}, pub=${proofDataA.publicInputs.length}`);

  // --- Prove Circuit B1 ---
  onStatus?.("[8/12] Proving Circuit B1 (header)...");
  t0 = performance.now();
  const backendB1 = new UltraHonkBackend(circuitB1.bytecode, { threads: 1 });
  let proofDataB1: ProofData;
  try {
    proofDataB1 = await backendB1.generateProof(resultB1.witness);
  } finally {
    await backendB1.destroy();
  }
  const timeB1 = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[prove:B1] Proof: ${timeB1}s, size=${proofDataB1.proof.length}, pub=${proofDataB1.publicInputs.length}`);

  // --- Prove Circuit B2 ---
  onStatus?.("[9/12] Proving Circuit B2 (MPT step 1)...");
  t0 = performance.now();
  const backendB2 = new UltraHonkBackend(circuitB2.bytecode, { threads: 1 });
  let proofDataB2: ProofData;
  try {
    proofDataB2 = await backendB2.generateProof(resultB2.witness);
  } finally {
    await backendB2.destroy();
  }
  const timeB2 = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[prove:B2] Proof: ${timeB2}s, size=${proofDataB2.proof.length}, pub=${proofDataB2.publicInputs.length}`);

  // --- Prove Circuit B3 ---
  onStatus?.("[10/12] Proving Circuit B3 (MPT step 2)...");
  t0 = performance.now();
  const backendB3 = new UltraHonkBackend(circuitB2.bytecode, { threads: 1 });
  let proofDataB3: ProofData;
  try {
    proofDataB3 = await backendB3.generateProof(resultB3.witness);
  } finally {
    await backendB3.destroy();
  }
  const timeB3 = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[prove:B3] Proof: ${timeB3}s, size=${proofDataB3.proof.length}, pub=${proofDataB3.publicInputs.length}`);

  // --- Prove Circuit B4 ---
  onStatus?.("[11/12] Proving Circuit B4 (balance final)...");
  t0 = performance.now();
  const backendB4 = new UltraHonkBackend(circuitB4.bytecode, { threads: 1 });
  let proofDataB4: ProofData;
  try {
    proofDataB4 = await backendB4.generateProof(resultB4.witness);
  } finally {
    await backendB4.destroy();
  }
  const timeB4 = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[prove:B4] Proof: ${timeB4}s, size=${proofDataB4.proof.length}, pub=${proofDataB4.publicInputs.length}`);

  const totalTime = ((performance.now() - totalStart) / 1000).toFixed(1);
  console.log(`[prove] Total: ${totalTime}s (exec=${executeTime}s, prove=${((performance.now() - totalStart) / 1000 - parseFloat(executeTime)).toFixed(1)}s)`);
  onStatus?.(`[12/12] All 5 proofs generated (${totalTime}s total)`);

  return {
    proofA: proofDataA.proof,
    publicInputsA: proofDataA.publicInputs,
    proofB1: proofDataB1.proof,
    publicInputsB1: proofDataB1.publicInputs,
    proofB2: proofDataB2.proof,
    publicInputsB2: proofDataB2.publicInputs,
    proofB3: proofDataB3.proof,
    publicInputsB3: proofDataB3.publicInputs,
    proofB4: proofDataB4.proof,
    publicInputsB4: proofDataB4.publicInputs,
  };
}
