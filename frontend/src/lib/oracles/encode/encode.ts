import type { Address, Hex } from "viem";
import { isAddress, isHex } from "viem";
import {
  BYTE_HEX_LEN,
  BITS_IN_BYTE,
  BYTES32_LEN,
  MODULUS,
  MAX_TRIE_NODE_LEN,
  ZERO_PAD_VALUE,
  U128_MAX,
} from "./constants";
import { padArray } from "./utils";

export function encodeByte(byte: number): Hex {
  if (byte < 0 || byte >= 256) throw new Error(`Invalid byte: ${byte}`);
  return `0x${byte.toString(16).padStart(BYTE_HEX_LEN, "0")}`;
}

export function encodeField(arg: number | bigint): Hex {
  const val = BigInt(arg);
  if (val < 0n || val >= MODULUS) throw new Error("Field overflow");
  if (val === 0n) return "0x";
  let hex = val.toString(16);
  if (hex.length % BYTE_HEX_LEN === 1) hex = `0${hex}`;
  return `0x${hex}`;
}

export function encodeU128(arg: bigint): Hex {
  if (arg < 0n || arg >= U128_MAX) throw new Error("U128 overflow");
  return encodeField(arg);
}

export function encodeBytes32(value: bigint): Hex[] {
  return encodeBytes(value, BYTES32_LEN);
}

export function encodeAddress(value: Address): Hex[] {
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
  return encodeHex(value);
}

export function encodeBytes(value: bigint, length: number): Hex[] {
  if (value < 0n) throw new Error("Negative value");
  if (value >= 1n << (BITS_IN_BYTE * BigInt(length)))
    throw new Error("Overflow");
  const hexValue = value.toString(16).padStart(length * BYTE_HEX_LEN, "0");
  return encodeHex(`0x${hexValue}`);
}

export function encodeHex(hexString: string): Hex[] {
  if (!isHex(hexString)) throw new Error(`Invalid hex string: ${hexString}`);
  const chunks: Hex[] = [];
  const parity = hexString.length % BYTE_HEX_LEN;
  if (parity === 1) {
    chunks.push(`0x0${hexString[BYTE_HEX_LEN]}`);
  }
  for (let i = BYTE_HEX_LEN + parity; i < hexString.length; i += BYTE_HEX_LEN) {
    const chunk = hexString.substring(i, i + BYTE_HEX_LEN);
    chunks.push(`0x${chunk}`);
  }
  return chunks;
}

export function encodeProofNode(node: Hex): Hex[] {
  const encodedNode = encodeHex(node);
  if (encodedNode.length > MAX_TRIE_NODE_LEN) {
    throw new Error(
      `Proof node length: ${encodedNode.length} exceeds max: ${MAX_TRIE_NODE_LEN}`
    );
  }
  return padArray(encodeHex(node), MAX_TRIE_NODE_LEN, ZERO_PAD_VALUE);
}

export function encodeProof(proof: Hex[], length: number): Hex[] {
  // Build the flat array without .flat() to avoid large intermediate arrays
  const encodedUnPaddedProof: Hex[] = [];
  for (const node of proof) {
    const encoded = encodeProofNode(node);
    for (let i = 0; i < encoded.length; i++) {
      encodedUnPaddedProof.push(encoded[i]);
    }
  }
  return padArray(encodedUnPaddedProof, length, ZERO_PAD_VALUE);
}
