import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

interface VerifyRequest {
  proof: number[];
  publicInputs: string[];
}

// Cache the circuit bytecode
let circuitBytecodeCache: string | null = null;

function loadCircuitBytecode(): string {
  if (circuitBytecodeCache) return circuitBytecodeCache;

  const circuitPath = join(
    process.cwd(),
    "public",
    "circuits",
    "verify_balance.json"
  );
  const circuit = JSON.parse(readFileSync(circuitPath, "utf-8"));
  circuitBytecodeCache = circuit.bytecode as string;
  return circuitBytecodeCache!;
}

// Decode public inputs from the proof.
// Circuit signature: main(chain_id: pub u32, block_number: pub u64, public_balance: pub u128)
//                    -> pub ([u8; 32], Field)
// Public inputs order: chain_id, block_number, public_balance, block_hash[0..31], nullifier
function decodePublicInputs(publicInputs: string[]) {
  const chainId = Number(BigInt(publicInputs[0]));
  const blockNumber = Number(BigInt(publicInputs[1]));
  const publicBalance = BigInt(publicInputs[2]).toString();

  // block_hash is 32 bytes (indices 3-34)
  const blockHashBytes = publicInputs.slice(3, 35).map((v) => {
    const n = Number(BigInt(v));
    return n.toString(16).padStart(2, "0");
  });
  const blockHash = "0x" + blockHashBytes.join("");

  // nullifier is a Field (index 35)
  const nullifier = publicInputs[35];

  return { chainId, blockNumber, publicBalance, blockHash, nullifier };
}

export async function POST(request: Request) {
  try {
    const body: VerifyRequest = await request.json();
    const { proof, publicInputs } = body;

    if (!proof || !publicInputs) {
      return NextResponse.json(
        { error: "Missing proof or publicInputs" },
        { status: 400 }
      );
    }

    const bytecode = loadCircuitBytecode();

    // Dynamic import to avoid webpack WASM bundling issues
    const { UltraHonkBackend } = await import("@aztec/bb.js");
    const backend = new UltraHonkBackend(bytecode);

    try {
      const proofUint8 = new Uint8Array(proof);
      const valid = await backend.verifyProof({
        proof: proofUint8,
        publicInputs,
      });

      const decoded = decodePublicInputs(publicInputs);
      return NextResponse.json({ valid, ...decoded });
    } finally {
      await backend.destroy();
    }
  } catch (err) {
    console.error("Verification error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed" },
      { status: 500 }
    );
  }
}
