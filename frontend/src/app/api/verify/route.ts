import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

interface VerifyRequest {
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

// Cache circuit bytecodes
const bytecodeCache: Record<string, string> = {};

function loadBytecode(name: string): string {
  if (bytecodeCache[name]) return bytecodeCache[name];
  const path = join(process.cwd(), "public", "circuits", `${name}.json`);
  const circuit = JSON.parse(readFileSync(path, "utf-8"));
  bytecodeCache[name] = circuit.bytecode as string;
  return bytecodeCache[name];
}

// Decode public inputs from Circuit A: [commitment, nullifier]
function decodePublicInputsA(publicInputs: string[]) {
  return {
    commitment: publicInputs[0],
    nullifier: publicInputs[1],
  };
}

// Decode public inputs from Circuit B1:
// Public inputs: block_number, commitment_in, block_hash[0..31], link_out
// Total: 2 + 32 + 1 = 35
function decodePublicInputsB1(publicInputs: string[]) {
  const blockNumber = Number(BigInt(publicInputs[0]));
  const commitmentIn = publicInputs[1];

  // block_hash is 32 bytes (indices 2-33)
  const blockHashBytes = publicInputs.slice(2, 34).map((v) => {
    const n = Number(BigInt(v));
    return n.toString(16).padStart(2, "0");
  });
  const blockHash = "0x" + blockHashBytes.join("");

  const linkOut = publicInputs[34];

  return { blockNumber, commitmentIn, blockHash, linkOut };
}

// Decode public inputs from Circuit B2/B3: [link_in, link_out]
function decodePublicInputsB2B3(publicInputs: string[]) {
  return {
    linkIn: publicInputs[0],
    linkOut: publicInputs[1],
  };
}

// Decode public inputs from Circuit B4: [link_in, public_balance]
function decodePublicInputsB4(publicInputs: string[]) {
  return {
    linkIn: publicInputs[0],
    publicBalance: BigInt(publicInputs[1]).toString(),
  };
}

export async function POST(request: Request) {
  try {
    const body: VerifyRequest = await request.json();
    const {
      proofA, publicInputsA,
      proofB1, publicInputsB1,
      proofB2, publicInputsB2,
      proofB3, publicInputsB3,
      proofB4, publicInputsB4,
    } = body;

    if (!proofA || !publicInputsA || !proofB1 || !publicInputsB1 ||
        !proofB2 || !publicInputsB2 || !proofB3 || !publicInputsB3 ||
        !proofB4 || !publicInputsB4) {
      return NextResponse.json(
        { error: "Missing one or more proof/publicInputs fields" },
        { status: 400 }
      );
    }

    // Load bytecodes (B2 circuit is reused for B3)
    const bytecodeA = loadBytecode("identity_nullifier");
    const bytecodeB1 = loadBytecode("balance_header");
    const bytecodeB2 = loadBytecode("balance_mpt_step");
    const bytecodeB4 = loadBytecode("balance_final");

    const { UltraHonkBackend } = await import("@aztec/bb.js");

    // Verify all 5 proofs
    const proofs = [
      { name: "A", bytecode: bytecodeA, proof: proofA, publicInputs: publicInputsA },
      { name: "B1", bytecode: bytecodeB1, proof: proofB1, publicInputs: publicInputsB1 },
      { name: "B2", bytecode: bytecodeB2, proof: proofB2, publicInputs: publicInputsB2 },
      { name: "B3", bytecode: bytecodeB2, proof: proofB3, publicInputs: publicInputsB3 },
      { name: "B4", bytecode: bytecodeB4, proof: proofB4, publicInputs: publicInputsB4 },
    ];

    for (const p of proofs) {
      const backend = new UltraHonkBackend(p.bytecode);
      let valid: boolean;
      try {
        valid = await backend.verifyProof({
          proof: new Uint8Array(p.proof),
          publicInputs: p.publicInputs,
        });
      } finally {
        await backend.destroy();
      }
      if (!valid) {
        return NextResponse.json(
          { valid: false, error: `Proof ${p.name} verification failed` },
          { status: 200 }
        );
      }
    }

    // Cross-check link chain
    const decodedA = decodePublicInputsA(publicInputsA);
    const decodedB1 = decodePublicInputsB1(publicInputsB1);
    const decodedB2 = decodePublicInputsB2B3(publicInputsB2);
    const decodedB3 = decodePublicInputsB2B3(publicInputsB3);
    const decodedB4 = decodePublicInputsB4(publicInputsB4);

    // A.commitment == B1.commitment_in
    if (decodedA.commitment !== decodedB1.commitmentIn) {
      return NextResponse.json(
        { valid: false, error: "Commitment mismatch: A.commitment != B1.commitment_in" },
        { status: 200 }
      );
    }

    // B1.link_out == B2.link_in
    if (decodedB1.linkOut !== decodedB2.linkIn) {
      return NextResponse.json(
        { valid: false, error: "Link mismatch: B1.link_out != B2.link_in" },
        { status: 200 }
      );
    }

    // B2.link_out == B3.link_in
    if (decodedB2.linkOut !== decodedB3.linkIn) {
      return NextResponse.json(
        { valid: false, error: "Link mismatch: B2.link_out != B3.link_in" },
        { status: 200 }
      );
    }

    // B3.link_out == B4.link_in
    if (decodedB3.linkOut !== decodedB4.linkIn) {
      return NextResponse.json(
        { valid: false, error: "Link mismatch: B3.link_out != B4.link_in" },
        { status: 200 }
      );
    }

    return NextResponse.json({
      valid: true,
      blockNumber: decodedB1.blockNumber,
      publicBalance: decodedB4.publicBalance,
      blockHash: decodedB1.blockHash,
      nullifier: decodedA.nullifier,
    });
  } catch (err) {
    console.error("Verification error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed" },
      { status: 500 }
    );
  }
}
