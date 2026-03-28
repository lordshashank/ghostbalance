import type { AuthStrategy, AuthContext } from "../../types.js";
import type { ProofBundle, VerificationConfig } from "./verify.js";
import { verifyProofBundle } from "./verify.js";

const PROOF_FIELDS = [
  "proofA", "publicInputsA",
  "proofB1", "publicInputsB1",
  "proofB2", "publicInputsB2",
  "proofB3", "publicInputsB3",
  "proofB4", "publicInputsB4",
] as const;

export function extractProofBundle(
  body: Record<string, unknown>
): ProofBundle | null {
  for (const field of PROOF_FIELDS) {
    if (!Array.isArray(body[field])) return null;
  }
  return {
    proofA: body.proofA as number[],
    publicInputsA: body.publicInputsA as string[],
    proofB1: body.proofB1 as number[],
    publicInputsB1: body.publicInputsB1 as string[],
    proofB2: body.proofB2 as number[],
    publicInputsB2: body.publicInputsB2 as string[],
    proofB3: body.proofB3 as number[],
    publicInputsB3: body.publicInputsB3 as string[],
    proofB4: body.proofB4 as number[],
    publicInputsB4: body.publicInputsB4 as string[],
  };
}

export function createZkProofStrategy(
  config: VerificationConfig
): AuthStrategy {
  return {
    name: "zkproof",

    async authenticate(_req, body): Promise<AuthContext | null> {
      const bundle = extractProofBundle(body);
      if (!bundle) return null;

      const result = await verifyProofBundle(bundle, config);

      if (!result.valid) return null;

      return {
        userId: result.nullifier!,
        strategy: "zkproof",
        blockNumber: result.blockNumber,
        publicBalance: result.publicBalance,
        blockHash: result.blockHash,
      };
    },
  };
}

export type { ProofBundle, VerificationConfig, VerificationResult } from "./verify.js";
