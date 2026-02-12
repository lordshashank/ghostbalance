import { BYTES32_LEN, MAX_TRIE_NODE_LEN, U64_LEN } from "./constants";
import { getMaxRlpEncodedSize } from "./utils";

export interface ProofConfig {
  maxKeyLen: number;
  maxValueLen: number;
  maxPrefixedKeyNibbleLen: number;
  maxLeafLen: number;
  maxProofDepth: number;
  maxProofLen: number;
}

export function getProofConfig(
  maxKeyLen: number,
  maxValueLen: number,
  maxProofDepth: number
): ProofConfig {
  const maxPrefixedKeyLen = 1 + maxKeyLen;
  const maxPrefixedKeyNibbleLen = maxPrefixedKeyLen * 2; // BYTE_HEX_LEN = 2
  const maxLeafContentLen =
    getMaxRlpEncodedSize(maxPrefixedKeyLen) +
    getMaxRlpEncodedSize(maxValueLen);
  const maxProofLen = MAX_TRIE_NODE_LEN * maxProofDepth;

  return {
    maxKeyLen,
    maxValueLen,
    maxPrefixedKeyNibbleLen,
    maxLeafLen: getMaxRlpEncodedSize(maxLeafContentLen),
    maxProofDepth,
    maxProofLen,
  };
}

// Account proof config
const ACCOUNT_KEY_LEN = BYTES32_LEN;
const ACCOUNT_MAX_VALUE_CONTENT_LEN =
  getMaxRlpEncodedSize(U64_LEN) + // Nonce
  getMaxRlpEncodedSize(BYTES32_LEN) + // Balance
  getMaxRlpEncodedSize(BYTES32_LEN) + // Storage root
  getMaxRlpEncodedSize(BYTES32_LEN); // Code hash
const ACCOUNT_MAX_VALUE_LEN = getMaxRlpEncodedSize(
  ACCOUNT_MAX_VALUE_CONTENT_LEN
);
const ACCOUNT_MAX_PROOF_LEVELS = 11;

export const accountProofConfig = getProofConfig(
  ACCOUNT_KEY_LEN,
  ACCOUNT_MAX_VALUE_LEN,
  ACCOUNT_MAX_PROOF_LEVELS
);
