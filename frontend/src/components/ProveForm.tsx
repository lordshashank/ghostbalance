"use client";

import { useState, useCallback } from "react";
import { useAccount, usePublicClient, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { parseEther, type Hex } from "viem";
import { IDENTITY_MESSAGE, recoverIdentity } from "@/lib/noir/identity";
import { generateProof, type ProveInputs } from "@/lib/noir/prove";
import { createForeignCallHandler } from "@/lib/oracles/handler";

type Status =
  | "idle"
  | "signing"
  | "fetching_block"
  | "executing"
  | "proving"
  | "verifying"
  | "done"
  | "error";

interface VerifyResult {
  valid: boolean;
  chainId: number;
  blockNumber: number;
  publicBalance: string;
  blockHash: string;
  nullifier: string;
}

export function ProveForm() {
  const { address, isConnected, chain } = useAccount();
  const publicClient = usePublicClient();
  const { signMessageAsync } = useSignMessage();

  const [publicBalance, setPublicBalance] = useState("0.001");
  const [nullifierBalance, setNullifierBalance] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleProve = useCallback(async () => {
    if (!isConnected || !publicClient || !chain) return;

    setStatus("signing");
    setStatusMessage("Signing identity message...");
    setResult(null);
    setError(null);

    try {
      // Step 1: Sign identity message
      const signature = await signMessageAsync({
        message: IDENTITY_MESSAGE,
      });

      // Step 2: Recover public key from signature
      const identity = await recoverIdentity(signature as Hex);

      // Step 3: Get latest block number
      setStatus("fetching_block");
      setStatusMessage("Fetching latest block...");
      const blockNumber = await publicClient.getBlockNumber();

      // Step 4: Prepare inputs
      const pubBalanceWei = parseEther(publicBalance);
      const nullBalanceWei = nullifierBalance
        ? parseEther(nullifierBalance)
        : pubBalanceWei;

      const inputs: ProveInputs = {
        chain_id: chain.id.toString(),
        block_number: blockNumber.toString(),
        public_balance: pubBalanceWei.toString(),
        nullifier_balance: nullBalanceWei.toString(),
        signature: identity.signature,
        public_key_x: identity.pubKeyX,
        public_key_y: identity.pubKeyY,
      };

      // Step 5: Generate proof (execute circuit + prove)
      setStatus("executing");
      const foreignCallHandler = createForeignCallHandler(publicClient);
      const proofResult = await generateProof(
        inputs,
        foreignCallHandler,
        (msg) => {
          if (msg.includes("Executing")) {
            setStatus("executing");
          } else if (msg.includes("Generating proof")) {
            setStatus("proving");
          }
          setStatusMessage(msg);
        }
      );

      // Step 6: Send to verification server
      setStatus("verifying");
      setStatusMessage("Verifying proof on server...");

      const proofArray = Array.from(proofResult.proof);
      const verifyResp = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proof: proofArray,
          publicInputs: proofResult.publicInputs,
        }),
      });

      if (!verifyResp.ok) {
        const errBody = await verifyResp.text();
        throw new Error(`Verification request failed: ${errBody}`);
      }

      const verifyResult: VerifyResult = await verifyResp.json();
      setResult(verifyResult);
      setStatus("done");
      setStatusMessage("Proof verified!");
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

          {statusMessage && (
            <div className="p-3 bg-gray-800 rounded text-sm">
              <StatusIndicator status={status} />
              <span className="ml-2">{statusMessage}</span>
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
              <Field label="Chain ID" value={result.chainId.toString()} />
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

function StatusIndicator({ status }: { status: Status }) {
  if (status === "done") {
    return <span className="text-green-400">&#10003;</span>;
  }
  if (status === "error") {
    return <span className="text-red-400">&#10007;</span>;
  }
  return <span className="animate-spin inline-block">&#9696;</span>;
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
