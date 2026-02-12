import { Noir } from "@noir-lang/noir_js";
import type { CompiledCircuit } from "@noir-lang/types";
import type { InputMap } from "@noir-lang/noirc_abi";
import type { ForeignCallHandler } from "@noir-lang/acvm_js";
import { UltraHonkBackend } from "@aztec/bb.js";
import type { ProofData } from "@aztec/bb.js";
import { patchCrsFetch } from "./crsProxy";

export interface ProveInputs {
  chain_id: string;
  block_number: string;
  public_balance: string;
  nullifier_balance: string;
  signature: string[];
  public_key_x: string[];
  public_key_y: string[];
  [key: string]: string | string[];
}

export interface ProveResult {
  proof: Uint8Array;
  publicInputs: string[];
}

let circuitCache: CompiledCircuit | null = null;

async function loadCircuit(): Promise<CompiledCircuit> {
  if (circuitCache) return circuitCache;
  const resp = await fetch("/circuits/verify_balance.json");
  if (!resp.ok) throw new Error("Failed to load circuit");
  circuitCache = (await resp.json()) as CompiledCircuit;
  return circuitCache;
}

export async function generateProof(
  inputs: ProveInputs,
  foreignCallHandler: ForeignCallHandler,
  onStatus?: (status: string) => void
): Promise<ProveResult> {
  onStatus?.("Loading circuit...");
  const circuit = await loadCircuit();
  console.log("[prove] Circuit loaded, bytecode length:", circuit.bytecode.length);

  onStatus?.("Executing circuit (oracle calls)...");
  const noir = new Noir(circuit);

  // Wrap handler with logging to debug foreign call issues
  const wrappedHandler: ForeignCallHandler = async (name, inputs) => {
    console.log(`[oracle] Called: ${name}, input count: ${inputs.length}`);
    try {
      const result = await foreignCallHandler(name, inputs);
      console.log(
        `[oracle] ${name} returned ${result.length} outputs`,
        result.map((r) =>
          typeof r === "string"
            ? `string(${r.slice(0, 20)}...)`
            : `array[${r.length}]`
        )
      );
      return result;
    } catch (err) {
      console.error(`[oracle] ${name} failed:`, err);
      throw err;
    }
  };

  console.log("[prove] Starting noir.execute...");
  const { witness } = await noir.execute(inputs, wrappedHandler);
  console.log("[prove] Witness generated, size:", witness.length);

  onStatus?.("Generating proof (this may take 30-60s)...");
  patchCrsFetch();
  console.log("[prove] Creating UltraHonkBackend...");
  const backend = new UltraHonkBackend(circuit.bytecode);
  console.log(
    "[prove] Backend created, uncompressed bytecode size:",
    ((backend as unknown as { acirUncompressedBytecode: Uint8Array })
      .acirUncompressedBytecode?.length / 1024 / 1024).toFixed(1),
    "MB"
  );
  try {
    console.log("[prove] Calling generateProof (witness size:", witness.length, "bytes)...");
    const proofData: ProofData = await backend.generateProof(witness);
    console.log(
      "[prove] Proof generated, size:",
      proofData.proof.length,
      "publicInputs:",
      proofData.publicInputs.length
    );
    return {
      proof: proofData.proof,
      publicInputs: proofData.publicInputs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errType = err instanceof Error ? err.constructor.name : typeof err;
    const stack = err instanceof Error ? err.stack : "";
    console.error("[prove] generateProof failed:", msg);
    console.error("[prove] Error type:", errType);
    console.error("[prove] Error object:", err);
    if (stack) console.error("[prove] Stack:", stack);
    throw err;
  } finally {
    await backend.destroy();
  }
}

export async function verifyProof(
  proof: Uint8Array,
  publicInputs: string[]
): Promise<boolean> {
  const circuit = await loadCircuit();
  patchCrsFetch();
  const backend = new UltraHonkBackend(circuit.bytecode);
  try {
    const valid = await backend.verifyProof({ proof, publicInputs });
    return valid;
  } finally {
    await backend.destroy();
  }
}
