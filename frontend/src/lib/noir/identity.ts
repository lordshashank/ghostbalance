import { hashMessage, recoverPublicKey, type Hex } from "viem";

export const IDENTITY_MESSAGE = "RedactedChat:v0:identity";

export interface IdentityData {
  pubKeyX: string[]; // 32 bytes as hex strings
  pubKeyY: string[]; // 32 bytes as hex strings
  signature: string[]; // 64 bytes (r || s) as hex strings
}

// Sign the identity message and recover the public key.
// Returns pubKeyX, pubKeyY (32 bytes each), and signature r||s (64 bytes).
export async function recoverIdentity(
  signatureHex: Hex
): Promise<IdentityData> {
  // Recover uncompressed public key (0x04 || x || y)
  const msgHash = hashMessage(IDENTITY_MESSAGE);
  const uncompressedPubKey = await recoverPublicKey({
    hash: msgHash,
    signature: signatureHex,
  });

  // uncompressedPubKey is 0x04 + 64 bytes (x: 32, y: 32) = 130 hex chars total
  const pubKeyHex = uncompressedPubKey.slice(4); // Remove 0x04 prefix
  const pubKeyX = hexToByteArray(pubKeyHex.slice(0, 64));
  const pubKeyY = hexToByteArray(pubKeyHex.slice(64, 128));

  // Extract r, s from signature (each 32 bytes = 64 hex chars)
  // EIP-191 signature is r (32) + s (32) + v (1) = 65 bytes
  const sigHex = signatureHex.slice(2); // Remove 0x
  const r = sigHex.slice(0, 64);
  const s = sigHex.slice(64, 128);
  const signature = hexToByteArray(r + s); // 64 bytes

  return { pubKeyX, pubKeyY, signature };
}

function hexToByteArray(hex: string): string[] {
  const bytes: string[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push("0x" + hex.slice(i, i + 2));
  }
  return bytes;
}
