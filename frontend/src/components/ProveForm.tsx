"use client";

import { useState, useCallback } from "react";
import { useAccount, usePublicClient, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { parseEther, type Hex } from "viem";
import { IDENTITY_MESSAGE, recoverIdentity } from "@/lib/noir/identity";
import {
  generateShardedProof,
  type CircuitAInputs,
} from "@/lib/noir/prove";
import { fetchProofData } from "@/lib/noir/fetchProofData";

type Status =
  | "idle"
  | "signing"
  | "fetching_data"
  | "executing"
  | "proving"
  | "verifying"
  | "done"
  | "error";

interface VerifyResult {
  valid: boolean;
  blockNumber: number;
  publicBalance: string;
  blockHash: string;
  nullifier: string;
}

/** Generate a random blinding factor (31 bytes -> decimal string Field element) */
function generateBlinding(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  let value = 0n;
  for (const b of bytes) {
    value = (value << 8n) | BigInt(b);
  }
  return value.toString();
}

/** Convert 0x-prefixed address to array of 20 hex-prefixed byte strings */
function addressToByteStrings(address: string): string[] {
  const hex = address.startsWith("0x") ? address.slice(2) : address;
  const bytes: string[] = [];
  for (let i = 0; i < 40; i += 2) {
    bytes.push("0x" + hex.slice(i, i + 2));
  }
  return bytes;
}

export function ProveForm() {
  const { address, isConnected, chain } = useAccount();
  const publicClient = usePublicClient();
  const { signMessageAsync } = useSignMessage();

  const [publicBalance, setPublicBalance] = useState("0.001");
  const [nullifierBalance, setNullifierBalance] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleProve = useCallback(async () => {
    if (!isConnected || !publicClient || !chain || !address) return;

    setStatus("signing");
    setStatusMessage("Signing identity message...");
    setCompletedSteps([]);
    setResult(null);
    setError(null);

    const addStep = (step: string) =>
      setCompletedSteps((prev) => [...prev, step]);

    try {
      // Step 1: Sign identity message
      const signature = await signMessageAsync({
        message: IDENTITY_MESSAGE,
      });

      addStep("Identity message signed");

      // Step 2: Recover public key from signature
      const identity = await recoverIdentity(signature as Hex);
      addStep("Public key recovered from signature");

      // Step 3: Get latest block number
      setStatus("fetching_data");
      setStatusMessage("Fetching latest block...");
      const blockNumber = await publicClient.getBlockNumber();
      addStep(`Block number fetched: ${blockNumber}`);

      // Step 4: Fetch Ethereum proof data (replaces oracle)
      setStatusMessage("Fetching Ethereum state proof...");
      const proofData = await fetchProofData(
        publicClient as Parameters<typeof fetchProofData>[0],
        address as Hex,
        blockNumber
      );
      addStep(`State proof fetched (${proofData.mpt.depth} nodes, ${proofData.header.rlpLen}B header)`);

      // Step 5: Prepare inputs
      const pubBalanceWei = parseEther(publicBalance);
      const nullBalanceWei = nullifierBalance
        ? parseEther(nullifierBalance)
        : pubBalanceWei;

      const blinding = generateBlinding();

      const inputsA: CircuitAInputs = {
        nullifier_balance: nullBalanceWei.toString(),
        signature: identity.signature,
        public_key_x: identity.pubKeyX,
        public_key_y: identity.pubKeyY,
        blinding,
      };

      // Step 6: Generate all 5 sharded proofs
      setStatus("executing");
      addStep("Starting sharded proof generation (5 circuits)...");
      const proofResult = await generateShardedProof(
        inputsA,
        proofData,
        blockNumber,
        pubBalanceWei,
        nullBalanceWei,
        blinding,
        addressToByteStrings(address),
        (msg) => {
          // Track phase transitions
          if (msg.includes("[7/12]")) {
            setStatus("proving");
            addStep("All 5 circuits executed successfully");
          }
          if (msg.includes("[12/12]")) {
            addStep("All 5 proofs generated");
          }
          setStatusMessage(msg);
        }
      );
      addStep(
        `Proofs ready (A:${proofResult.proofA.length}B B1:${proofResult.proofB1.length}B ` +
        `B2:${proofResult.proofB2.length}B B3:${proofResult.proofB3.length}B B4:${proofResult.proofB4.length}B)`
      );

      // Step 7: Send all 5 proofs to verification server
      setStatus("verifying");
      setStatusMessage("Verifying all 5 proofs on server...");

      const verifyResp = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proofA: Array.from(proofResult.proofA),
          publicInputsA: proofResult.publicInputsA,
          proofB1: Array.from(proofResult.proofB1),
          publicInputsB1: proofResult.publicInputsB1,
          proofB2: Array.from(proofResult.proofB2),
          publicInputsB2: proofResult.publicInputsB2,
          proofB3: Array.from(proofResult.proofB3),
          publicInputsB3: proofResult.publicInputsB3,
          proofB4: Array.from(proofResult.proofB4),
          publicInputsB4: proofResult.publicInputsB4,
        }),
      });

      if (!verifyResp.ok) {
        const errBody = await verifyResp.text();
        throw new Error(`Verification request failed: ${errBody}`);
      }

      const verifyResult: VerifyResult = await verifyResp.json();
      setResult(verifyResult);
      setStatus("done");
      addStep("Server verification complete");
      setStatusMessage("All proofs verified!");
    } catch (err) {
      console.error("Prove error:", err);
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      setStatusMessage("");
    }
  }, [
    isConnected,
    publicClient,
    chain,
    address,
    signMessageAsync,
    publicBalance,
    nullifierBalance,
  ]);

  const isWorking =
    status !== "idle" && status !== "done" && status !== "error";

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">RedactedChat</h1>
        <ConnectButton />
      </div>

      <p className="text-sm text-gray-400">
        Prove your ETH balance with zero knowledge. Your address and exact
        balance stay private.
      </p>

      {isConnected && chain && (
        <div className="space-y-4">
          <div className="text-sm text-gray-500">
            Connected to {chain.name} (Chain {chain.id})
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Public Balance (ETH)
            </label>
            <input
              type="text"
              value={publicBalance}
              onChange={(e) => setPublicBalance(e.target.value)}
              placeholder="0.001"
              disabled={isWorking}
              className="w-full px-3 py-2 border border-gray-700 rounded bg-gray-900 text-white disabled:opacity-50"
            />
            <p className="text-xs text-gray-500 mt-1">
              The balance threshold revealed in the proof
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Nullifier Balance (ETH, optional)
            </label>
            <input
              type="text"
              value={nullifierBalance}
              onChange={(e) => setNullifierBalance(e.target.value)}
              placeholder={`Defaults to ${publicBalance}`}
              disabled={isWorking}
              className="w-full px-3 py-2 border border-gray-700 rounded bg-gray-900 text-white disabled:opacity-50"
            />
            <p className="text-xs text-gray-500 mt-1">
              Balance used for nullifier identity derivation
            </p>
          </div>

          <button
            onClick={handleProve}
            disabled={isWorking || !publicBalance}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded transition-colors"
          >
            {isWorking ? "Working..." : "Generate Proof"}
          </button>

          {(statusMessage || completedSteps.length > 0) && (
            <div className="p-3 bg-gray-800 rounded text-sm space-y-1">
              {completedSteps.map((step, i) => (
                <div key={i} className="text-gray-400">
                  <span className="text-green-400">&#10003;</span>
                  <span className="ml-2">{step}</span>
                </div>
              ))}
              {statusMessage && status !== "done" && status !== "error" && (
                <div>
                  <span className="animate-spin inline-block">&#9696;</span>
                  <span className="ml-2">{statusMessage}</span>
                </div>
              )}
              {status === "done" && statusMessage && (
                <div>
                  <span className="text-green-400">&#10003;</span>
                  <span className="ml-2 text-green-400 font-medium">{statusMessage}</span>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-900/50 border border-red-700 rounded text-sm text-red-200">
              {error}
            </div>
          )}

          {result && (
            <div className="p-4 bg-gray-800 rounded space-y-2 text-sm">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`inline-block w-3 h-3 rounded-full ${
                    result.valid ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="font-medium">
                  {result.valid ? "Proof Valid" : "Proof Invalid"}
                </span>
              </div>
              <Field
                label="Block Number"
                value={result.blockNumber.toString()}
              />
              <Field label="Public Balance (wei)" value={result.publicBalance} />
              <Field label="Block Hash" value={result.blockHash} mono />
              <Field label="Nullifier" value={result.nullifier} mono />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-gray-400">{label}: </span>
      <span className={mono ? "font-mono text-xs break-all" : ""}>
        {value}
      </span>
    </div>
  );
}
