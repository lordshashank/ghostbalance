import type { Hex } from "viem";
import { fromRlp, isHex, keccak256 } from "viem";
import { encodeField, encodeHex, encodeProof } from "./encode";
import { padArray } from "./utils";
import { MAX_TRIE_NODE_LEN, ZERO_PAD_VALUE } from "./constants";
import { accountProofConfig } from "./proofConfig";

// Matches viem's GetProofReturnType shape
export interface EthProof {
  address: Hex;
  balance: bigint;
  codeHash: Hex;
  nonce: number;
  storageHash: Hex;
  storageProof: Array<{
    key: Hex;
    value: bigint;
    proof: Hex[];
  }>;
  accountProof: Hex[];
}

const RLP_VALUE_INDEX = 1;

export function encodeAccount(ethProof: EthProof): (Hex | Hex[])[] {
  const nonce = encodeField(ethProof.nonce);
  const balance = encodeField(ethProof.balance);
  const storageRoot = encodeHex(ethProof.storageHash);
  const codeHash = encodeHex(ethProof.codeHash);
  return [nonce, balance, storageRoot, codeHash];
}

function getValue(proof: Hex[]): Hex {
  const lastProofEntry = fromRlp(proof[proof.length - 1], "hex");
  const value = lastProofEntry[RLP_VALUE_INDEX];
  if (!isHex(value)) throw new Error("value should be of type Hex");
  return value;
}

function encodeValue(proof: Hex[]): string[] {
  return padArray(
    encodeHex(getValue(proof)),
    accountProofConfig.maxValueLen,
    ZERO_PAD_VALUE,
    "left"
  );
}

export function encodeStateProof(ethProof: EthProof): string[] {
  const key = padArray(
    encodeHex(keccak256(ethProof.address)),
    accountProofConfig.maxPrefixedKeyNibbleLen,
    ZERO_PAD_VALUE,
    "left"
  );
  const value = encodeValue(ethProof.accountProof);
  const nodes = encodeProof(
    ethProof.accountProof.slice(0, ethProof.accountProof.length - 1),
    (accountProofConfig.maxProofDepth - 1) * MAX_TRIE_NODE_LEN
  );
  const leaf = padArray(
    encodeHex(ethProof.accountProof[ethProof.accountProof.length - 1]),
    accountProofConfig.maxLeafLen,
    ZERO_PAD_VALUE
  );
  const depth = encodeField(ethProof.accountProof.length);

  // Use concat instead of spread to avoid stack overflow with large arrays
  // (nodes alone is ~5,300 elements)
  const result: string[] = [];
  result.push(...key);
  result.push(...value);
  // nodes is the large one (~5,300 elements) - use loop instead of spread
  for (let i = 0; i < nodes.length; i++) result.push(nodes[i]);
  result.push(...leaf);
  result.push(depth);
  return result;
}
