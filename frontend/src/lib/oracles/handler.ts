import type { PublicClient, Hex, Address } from "viem";
import { getAddress } from "viem";
import { decodeField } from "./encode/decode";
import { blockToHeader } from "./encode/blockHeader";
import { encodeBlockHeader } from "./encode/header";
import { encodeAccount, encodeStateProof } from "./encode/account";
import type { EthProof } from "./encode/account";

// noir_js foreign call handler for browser-based oracle resolution.
// Replaces the eth-proofs oracle server by making RPC calls directly
// from the browser via the user's wallet provider (viem PublicClient).
export function createForeignCallHandler(publicClient: PublicClient) {
  return async (
    name: string,
    inputs: string[][]
  ): Promise<(string | string[])[]> => {
    // noir_js passes inputs as arrays of hex strings without 0x prefix.
    // Add 0x prefix so our decode functions (ported from eth-proofs) work.
    const args = inputs.map((input) =>
      input.map((v) => {
        // Handle values that already have 0x prefix
        if (v.startsWith("0x")) return v;
        return "0x" + v;
      })
    );

    if (name === "get_header") {
      const blockNumber = decodeField(args[1][0]);
      const block = await publicClient.getBlock({
        blockNumber: blockNumber,
      });
      const header = blockToHeader(block);
      return encodeBlockHeader(header);
    }

    if (name === "get_account") {
      const blockNumber = decodeField(args[1][0]);
      // Address is passed as a 20-byte array
      const addressHex =
        "0x" +
        args[2]
          .map((b) => {
            const val = parseInt(b, 16);
            return val.toString(16).padStart(2, "0");
          })
          .join("");
      const address = getAddress(addressHex) as Address;

      const proof = await publicClient.getProof({
        address,
        storageKeys: [],
        blockNumber: blockNumber,
      });

      const ethProof: EthProof = {
        address: address as Hex,
        balance: proof.balance,
        codeHash: proof.codeHash,
        nonce: proof.nonce,
        storageHash: proof.storageHash,
        storageProof: proof.storageProof.map((sp) => ({
          key: sp.key,
          value: sp.value,
          proof: sp.proof as Hex[],
        })),
        accountProof: proof.accountProof as Hex[],
      };

      const encodedAccount = encodeAccount(ethProof);
      const encodedProof = encodeStateProof(ethProof);
      return [...encodedAccount, encodedProof];
    }

    throw new Error(`Unknown oracle: ${name}`);
  };
}
