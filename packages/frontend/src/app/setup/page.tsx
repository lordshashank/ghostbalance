"use client";

import { useState, useCallback, Suspense } from "react";
import { useAccount, useBalance, useConfig, useDisconnect, useSignMessage } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatEther, parseEther, type Hex } from "viem";
import { PROOF_CHAIN } from "@/providers/Web3Provider";
import { useRouter, useSearchParams } from "next/navigation";

import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { FileUploader } from "@/components/FileUploader";
import { ImageDisplay } from "@/components/ImageDisplay";
import { IDENTITY_MESSAGE, recoverIdentity } from "@/lib/noir/identity";
import {
  generateShardedProof,
  type CircuitAInputs,
} from "@/lib/noir/prove";
import { fetchProofData } from "@/lib/noir/fetchProofData";
import { apiFetch } from "@/lib/api";
import type { VerifyResult, Gender } from "@/lib/types";
import {
  saveProofBundle,
  loadProofBundle,
  saveNullifierSeed,
  loadNullifierSeed,
} from "@/lib/proofStore";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateProfile } from "@/hooks/useProfile";
import { useToast } from "@/providers/ToastProvider";

type Status =
  | "idle"
  | "signing"
  | "fetching_data"
  | "executing"
  | "proving"
  | "verifying"
  | "creating_profile"
  | "profile_details"
  | "done"
  | "error";

function generateBlinding(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  let value = 0n;
  for (const b of bytes) {
    value = (value << 8n) | BigInt(b);
  }
  return value.toString();
}

function addressToByteStrings(address: string): string[] {
  const hex = address.startsWith("0x") ? address.slice(2) : address;
  const bytes: string[] = [];
  for (let i = 0; i < 40; i += 2) {
    bytes.push("0x" + hex.slice(i, i + 2));
  }
  return bytes;
}

function getStepNumber(status: Status): number {
  switch (status) {
    case "idle":
      return 1;
    case "signing":
    case "fetching_data":
    case "executing":
    case "proving":
    case "verifying":
    case "creating_profile":
      return 2;
    case "profile_details":
      return 3;
    case "done":
      return 4;
    case "error":
      return 2;
    default:
      return 1;
  }
}

function OnboardingSidebar({
  status,
  completedSteps,
  statusMessage,
  error,
}: {
  status: Status;
  completedSteps: string[];
  statusMessage: string;
  error: string | null;
}) {
  const currentStep = getStepNumber(status);

  const steps = [
    { num: 1, label: "Connect & Balance" },
    { num: 2, label: "Generate Proof" },
    { num: 3, label: "Complete Profile" },
    { num: 4, label: "All Set" },
  ];

  return (
    <>
      <section className="glass-panel p-6">
        <h3 className="font-bold mb-6 tracking-tight text-primary matrix-glow flex items-center gap-2 uppercase text-xs tracking-[0.2em]">
          <Icon name="route" className="text-lg" />
          Onboarding Path
        </h3>
        <div className="space-y-6 font-mono">
          {steps.map((s) => (
            <div key={s.num} className="border-l-2 border-outline pl-4 py-1 relative">
              <div
                className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ${
                  currentStep >= s.num ? "bg-primary glow-dot" : "bg-primary/20"
                }`}
              />
              <p className="text-[10px] text-on-surface-variant/60 uppercase tracking-widest">
                Step {s.num}
              </p>
              <p className={`text-xs font-bold ${currentStep >= s.num ? "text-primary" : "text-on-surface-variant/60"}`}>
                {s.label}
              </p>
              <p className={`text-[9px] uppercase mt-1 ${
                currentStep === s.num ? "text-on-surface-variant" : currentStep > s.num ? "text-on-surface-variant" : "text-on-surface-variant/50"
              }`}>
                {currentStep < s.num ? "Locked" : currentStep === s.num ? "Active Phase" : "Complete"}
              </p>
            </div>
          ))}
        </div>
      </section>

      {completedSteps.length > 0 && (
        <section className="glass-panel p-6">
          <h4 className="text-xs font-bold text-primary mb-3 flex items-center gap-2 matrix-glow uppercase tracking-widest">
            <Icon name="terminal" className="text-primary text-lg" />
            Proof Log
          </h4>
          <div className="space-y-2 font-mono text-[11px] max-h-64 overflow-y-auto no-scrollbar">
            {completedSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-primary shrink-0">&#10003;</span>
                <span className="text-on-surface-variant">{step}</span>
              </div>
            ))}
            {statusMessage && status !== "done" && status !== "error" && status !== "profile_details" && (
              <div className="flex items-start gap-2">
                <span className="animate-spin text-primary shrink-0">&#9696;</span>
                <span className="text-on-surface-variant">{statusMessage}</span>
              </div>
            )}
            {status === "done" && statusMessage && (
              <div className="flex items-start gap-2">
                <span className="text-primary shrink-0">&#10003;</span>
                <span className="text-primary font-bold">{statusMessage}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {error && (
        <section className="glass-panel p-6 border-red-500/30">
          <h4 className="text-xs font-bold text-red-400 mb-2 uppercase tracking-widest">Error</h4>
          <p className="text-[11px] text-red-400/80 font-mono break-all">{error}</p>
        </section>
      )}

      <section className="glass-panel p-6">
        <h4 className="text-xs font-bold text-primary mb-3 flex items-center gap-2 matrix-glow uppercase tracking-widest">
          <Icon name="info" className="text-primary text-lg" />
          Protocol Logic
        </h4>
        <p className="text-[11px] leading-relaxed text-on-surface-variant font-mono">
          Our zero-knowledge architecture ensures your verified balance becomes
          your public identity without ever revealing your wallet addresses.
          <br /><br />
          Once proof is generated, it is cryptographically tied to your profile
          pseudonym, allowing you to interact with the ecosystem with total privacy.
        </p>
      </section>

      <footer className="px-5 text-[10px] text-on-surface-variant/50 uppercase tracking-widest font-mono">
        <p>&copy; 2026 ghostbalance.chat</p>
      </footer>
    </>
  );
}

function SetupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isReprove = searchParams.get("reprove") === "true";
  const { address, isConnected, isReconnecting } = useAccount();
  const { data: walletBalance } = useBalance({ address, chainId: PROOF_CHAIN.id });
  const wagmiConfig = useConfig();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const { user, refreshProfile } = useAuth();
  const updateProfile = useUpdateProfile();
  const { toastError, toastSuccess } = useToast();

  const [publicBalance, setPublicBalance] = useState("");
  const [nullifierSeed, setNullifierSeed] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step 2: Profile details
  const [bio, setBio] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [age, setAge] = useState("");
  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [bannerKey, setBannerKey] = useState<string | null>(null);

  const isWorking =
    status !== "idle" &&
    status !== "done" &&
    status !== "error" &&
    status !== "profile_details";

  const hasOnChainBalance = walletBalance && walletBalance.value > 0n;
  const canGenerateProof =
    isConnected && !isReconnecting && hasOnChainBalance && publicBalance && parseFloat(publicBalance) >= 0 && !isWorking;

  const proofCompleted = status === "profile_details" || status === "done";

  const handleProve = useCallback(async () => {
    if (!isConnected || !address) return;

    const publicClient = getPublicClient(wagmiConfig, { chainId: PROOF_CHAIN.id });
    if (!publicClient) return;

    setStatus("signing");
    setStatusMessage("Signing identity message...");
    setCompletedSteps([]);
    setVerifyResult(null);
    setError(null);

    const addStep = (step: string) =>
      setCompletedSteps((prev) => [...prev, step]);

    try {
      const signature = await signMessageAsync({ message: IDENTITY_MESSAGE });
      addStep("Identity message signed");

      const identity = await recoverIdentity(signature as Hex);
      addStep("Public key recovered from signature");

      setStatus("fetching_data");
      setStatusMessage("Fetching latest block...");
      const blockNumber = await publicClient.getBlockNumber();
      addStep(`Block number fetched: ${blockNumber}`);

      setStatusMessage("Fetching Ethereum state proof...");
      const proofData = await fetchProofData(
        publicClient as Parameters<typeof fetchProofData>[0],
        address as Hex,
        blockNumber
      );
      addStep(`State proof fetched (${proofData.mpt.depth} nodes, ${proofData.header.rlpLen}B header)`);

      const pubBalanceWei = parseEther(publicBalance);
      let nullSeedWei: bigint;

      if (isReprove) {
        // Reprove: prefer manually entered seed > stored seed > server initial_balance
        if (nullifierSeed) {
          nullSeedWei = parseEther(nullifierSeed);
          addStep("Using manually entered nullifier seed");
        } else {
          const storedNullSeed = loadNullifierSeed();
          if (storedNullSeed) {
            nullSeedWei = BigInt(storedNullSeed);
            addStep("Using stored nullifier seed");
          } else if (user?.initial_balance) {
            nullSeedWei = BigInt(user.initial_balance);
            addStep("Using initial balance as nullifier seed");
          } else {
            throw new Error("Cannot update balance: nullifier seed not found. Enter it in Advanced Options or create a new identity.");
          }
        }
      } else {
        // Registration: use custom nullifier seed or default to public balance
        nullSeedWei = nullifierSeed ? parseEther(nullifierSeed) : pubBalanceWei;
      }

      const blinding = generateBlinding();

      const inputsA: CircuitAInputs = {
        nullifier_seed: nullSeedWei.toString(),
        signature: identity.signature,
        public_key_x: identity.pubKeyX,
        public_key_y: identity.pubKeyY,
        blinding,
      };

      setStatus("executing");
      addStep("Building your privacy proof...");
      const proofResult = await generateShardedProof(
        inputsA, proofData, blockNumber, pubBalanceWei, nullSeedWei, blinding,
        addressToByteStrings(address),
        (msg) => {
          if (msg.includes("[7/12]")) { setStatus("proving"); addStep("Proof calculations complete"); }
          if (msg.includes("[12/12]")) { addStep("Privacy proof sealed"); }
          setStatusMessage(msg);
        }
      );
      addStep("Proof generated successfully");

      const proofBody = {
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
      };

      // Extract nullifier from Circuit A public outputs (index 1)
      const nullifier = proofResult.publicInputsA[1];
      const publicBalanceWei = pubBalanceWei.toString();

      saveProofBundle({
        ...proofBody,
        nullifier,
        publicBalance: publicBalanceWei,
        blockNumber: Number(blockNumber),
        blockHash: "",
        createdAt: Date.now(),
      });

      // Persist nullifier seed separately (survives proof bundle clears/logouts)
      saveNullifierSeed(nullSeedWei.toString());

      addStep("Proofs saved locally");

      // Check if user already has a profile
      setStatus("verifying");
      setStatusMessage("Checking identity...");

      let profileExists = false;
      try {
        await apiFetch(`/profiles/${nullifier}`);
        profileExists = true;
      } catch {
        profileExists = false;
      }

      if (isReprove) {
        // Reprove: call /auth/verify first to get session, then /profiles/reprove
        setStatusMessage("Verifying proofs on server...");
        const result = await apiFetch<VerifyResult>("/auth/verify", {
          method: "POST",
          body: JSON.stringify(proofBody),
        });
        setVerifyResult(result);
        addStep("Server verification complete");

        setStatusMessage("Updating balance...");
        await apiFetch("/profiles/reprove", {
          method: "POST",
          body: JSON.stringify(proofBody),
        });
        addStep("Balance updated successfully");
        await refreshProfile();
        setStatus("done");
        setStatusMessage("Reprove complete! Redirecting...");
        setTimeout(() => router.push("/profile"), 1500);
        return;
      }

      if (profileExists) {
        // Returning user: login via /auth/verify
        setStatusMessage("Verifying proofs on server...");
        const result = await apiFetch<VerifyResult>("/auth/verify", {
          method: "POST",
          body: JSON.stringify(proofBody),
        });
        setVerifyResult(result);
        addStep("Signed in successfully");
        await refreshProfile();
        setStatus("done");
        setStatusMessage("Welcome back! Redirecting...");
        setTimeout(() => router.push("/"), 1500);
        return;
      }

      // New user: create profile via POST /profiles (zkproof auth verifies proofs)
      setStatusMessage("Creating your anonymous profile...");
      setStatus("creating_profile");

      await apiFetch("/profiles", {
        method: "POST",
        body: JSON.stringify(proofBody),
      });

      addStep("Profile created! Complete your details below.");
      await refreshProfile();
      setStatus("profile_details");
      setStatusMessage("");
    } catch (err) {
      console.error("Prove error:", err);
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      setStatusMessage("");
    }
  }, [isConnected, address, wagmiConfig, signMessageAsync, publicBalance, nullifierSeed, isReprove, user, refreshProfile, router]);

  const handleSaveProfile = async () => {
    try {
      const updates: Record<string, unknown> = {};
      if (bio.trim()) updates.bio = bio.trim();
      if (gender) updates.gender = gender;
      if (age) updates.age = parseInt(age, 10);
      if (avatarKey) updates.avatar_key = avatarKey;
      if (bannerKey) updates.banner_key = bannerKey;

      if (Object.keys(updates).length > 0) {
        await apiFetch("/profiles", {
          method: "PATCH",
          body: JSON.stringify(updates),
        });
        await refreshProfile();
      }

      toastSuccess("Profile setup complete!");
      setStatus("done");
      setStatusMessage("All set! Redirecting...");
      setTimeout(() => router.push("/"), 1500);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to save profile");
    }
  };

  return (
    <AppLayout
      rightSidebar={
        <OnboardingSidebar
          status={status}
          completedSteps={completedSteps}
          statusMessage={statusMessage}
          error={error}
        />
      }
    >
      <PageHeader
        title="Setup Profile"
        subtitle="Initialization Phase"
        showBack
        onBack={() => router.back()}
      />

      <div className="p-6 space-y-8">
        {/* Hero */}
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tight text-primary matrix-glow">
            {isReprove ? "Update Your Balance" : "Create Your GhostBalance Profile"}
          </h2>
          <p className="text-on-surface-variant text-sm font-mono">
            {isReprove
              ? "Your identity stays the same. Only your displayed balance updates."
              : "Your identity is your balance. Stay anonymous."}
          </p>
        </div>

        {/* ═══ STEP 1: Proof Generation ═══ */}
        <section className={`space-y-6 ${proofCompleted ? "opacity-50 pointer-events-none" : ""}`}>
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-8 h-8 flex items-center justify-center font-bold text-sm border ${
              proofCompleted ? "bg-primary text-black border-primary" : "border-primary text-primary"
            }`}>
              {proofCompleted ? <Icon name="check" className="text-black text-sm" /> : "1"}
            </div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-primary">
              Verify Your Balance
            </h3>
          </div>

          {/* Wallet Connection */}
          <div className="space-y-4">
            <label className="text-[10px] uppercase tracking-widest text-primary font-bold block font-mono">
              Security &amp; Authentication
            </label>
            {isConnected ? (
              <div className="w-full bg-primary/10 border border-primary text-primary py-4 px-6 font-mono text-sm flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Icon name="check_circle" className="text-primary" />
                  <span>Wallet Connected ({address?.slice(0, 6)}...{address?.slice(-4)})</span>
                </div>
                <button
                  onClick={() => disconnect()}
                  className="text-[10px] uppercase tracking-widest font-bold hover:text-primary-glow transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button onClick={openConnectModal} className="w-full bg-primary text-black py-4 font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-3 hover:bg-primary/90 transition-all matrix-button-glow">
                    <Icon name="wallet" className="text-black" />
                    <span>Connect Wallet</span>
                  </button>
                )}
              </ConnectButton.Custom>
            )}
            {isConnected && (
              <div className="space-y-2">
                <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-widest text-on-surface-variant/60">
                  <span>Network: {PROOF_CHAIN.name}</span>
                  {walletBalance && (
                    <>
                      <span className="text-outline">|</span>
                      <span>Balance: <span className="text-primary font-bold">{parseFloat(walletBalance.formatted).toFixed(4)} {walletBalance.symbol}</span></span>
                    </>
                  )}
                </div>
                {walletBalance && walletBalance.value === 0n && (
                  <p className="text-[11px] text-red-400/80 font-mono">
                    This wallet has no balance on {PROOF_CHAIN.name}. You need ETH on this network to generate a proof.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Proof Balance */}
          <div className={`space-y-4 transition-all ${!isConnected ? "opacity-40 grayscale pointer-events-none" : ""}`}>
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-widest text-primary font-bold font-mono">Proof Balance</label>
              {!isConnected && (
                <span className="text-[10px] text-on-surface-variant/60 border border-outline px-2 py-1 uppercase font-mono">Connect Wallet First</span>
              )}
            </div>
            <div className="relative">
              <input
                type="number"
                value={publicBalance}
                onChange={(e) => setPublicBalance(e.target.value)}
                disabled={!isConnected || isWorking}
                className="w-full bg-background border border-outline focus:border-primary focus:ring-0 text-on-surface p-4 pr-16 font-mono disabled:opacity-50"
                placeholder="0.00"
                step="0.001"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-on-surface-variant/60 font-mono">ETH</span>
            </div>
            <p className="text-[11px] text-on-surface-variant/60 italic font-mono">
              This should be less than your actual balance to avoid on-chain reveal.
            </p>
          </div>

          {/* Advanced Options */}
          <div className={`transition-all ${!isConnected ? "opacity-40 grayscale pointer-events-none" : ""}`}>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-on-surface-variant/60 hover:text-primary font-bold font-mono transition-colors"
              >
                <Icon
                  name="expand_more"
                  className={`text-sm transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                />
                Advanced Options
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4 border border-outline p-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-primary font-bold font-mono">
                      Nullifier Seed (ETH)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={nullifierSeed || (isReprove
                          ? (() => { const s = loadNullifierSeed(); return s ? formatEther(BigInt(s)) : user?.initial_balance ? formatEther(BigInt(user.initial_balance)) : ""; })()
                          : publicBalance)}
                        onChange={(e) => setNullifierSeed(e.target.value)}
                        onFocus={() => {
                          if (!nullifierSeed) {
                            if (isReprove) {
                              const s = loadNullifierSeed();
                              setNullifierSeed(s ? formatEther(BigInt(s)) : user?.initial_balance ? formatEther(BigInt(user.initial_balance)) : "");
                            } else {
                              setNullifierSeed(publicBalance);
                            }
                          }
                        }}
                        disabled={!isConnected || isWorking}
                        className="w-full bg-background border border-outline focus:border-primary focus:ring-0 text-on-surface p-4 pr-16 font-mono disabled:opacity-50"
                        placeholder={isReprove ? "From stored seed" : "Same as proof balance"}
                        step="0.001"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-on-surface-variant/60 font-mono">ETH</span>
                    </div>
                  </div>
                  <div className="border border-primary/30 p-3 space-y-2">
                    <p className="text-[10px] uppercase tracking-widest text-primary font-bold font-mono flex items-center gap-1">
                      <Icon name="warning" className="text-sm" />
                      Recovery Warning
                    </p>
                    <p className="text-[11px] text-on-surface-variant/80 font-mono leading-relaxed">
                      If you set a custom nullifier seed, it will be stored on this device only.
                      You must remember this exact value to recover your account on a new device.
                    </p>
                  </div>
                </div>
              )}
            </div>

          {/* Proof Button / Status */}
          {status === "creating_profile" ? (
            <div className="border border-primary p-6">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-primary animate-pulse" style={{ boxShadow: "0 0 8px var(--glow-color)" }} />
                <span className="font-bold text-primary matrix-glow">{statusMessage || "Creating profile..."}</span>
              </div>
            </div>
          ) : status !== "profile_details" && status !== "done" ? (
            <button
              onClick={handleProve}
              disabled={!canGenerateProof}
              className={`w-full py-4 flex items-center justify-center gap-3 transition-all ${
                canGenerateProof
                  ? "bg-primary text-black font-bold uppercase tracking-widest text-sm hover:bg-primary/90 matrix-button-glow"
                  : "bg-background border border-outline text-on-surface-variant/50 cursor-not-allowed"
              }`}
            >
              <Icon name="verified_user" />
              <span className="font-bold uppercase tracking-[0.2em] text-xs">
                {isWorking ? "Generating Proof..." : isReprove ? "Generate New Proof" : "Generate Proof"}
              </span>
            </button>
          ) : null}
        </section>

        {/* ═══ STEP 2: Profile Details (enabled after proof) ═══ */}
        {!isReprove && (
          <section className={`space-y-6 transition-all ${!proofCompleted ? "opacity-30 grayscale pointer-events-none" : ""}`}>
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-8 h-8 flex items-center justify-center font-bold text-sm border ${
                status === "done" ? "bg-primary text-black border-primary" : proofCompleted ? "border-primary text-primary" : "border-outline text-on-surface-variant/50"
              }`}>
                {status === "done" ? <Icon name="check" className="text-black text-sm" /> : "2"}
              </div>
              <h3 className={`text-sm font-bold uppercase tracking-widest ${proofCompleted ? "text-primary" : "text-on-surface-variant/50"}`}>
                Complete Your Profile
              </h3>
              {!proofCompleted && (
                <span className="text-[9px] text-on-surface-variant/50 font-mono uppercase border border-outline px-2 py-0.5">
                  Complete Step 1 First
                </span>
              )}
            </div>

            {/* Banner Upload */}
            <div className="relative group">
              <FileUploader
                onComplete={(key) => setBannerKey(key)}
                className="h-40 w-full bg-background border border-dashed border-outline group-hover:border-primary/60 transition-colors cursor-pointer flex items-center justify-center overflow-hidden"
              >
                {bannerKey ? (
                  <ImageDisplay uploadKey={bannerKey} className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center">
                    <Icon name="add_a_photo" className="text-3xl text-on-surface-variant/60 mb-1" />
                    <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/60 group-hover:text-primary transition-colors font-bold font-mono">
                      Upload Banner Image
                    </p>
                  </div>
                )}
              </FileUploader>
              {/* Avatar overlay */}
              <div className="absolute -bottom-8 left-6">
                <FileUploader
                  onComplete={(key) => setAvatarKey(key)}
                  className="h-20 w-20 bg-background border-2 border-primary overflow-hidden flex items-center justify-center group/avatar relative"
                >
                  {avatarKey ? (
                    <ImageDisplay uploadKey={avatarKey} className="w-full h-full object-cover" />
                  ) : (
                    <>
                      <Icon name="camera" className="text-2xl text-on-surface-variant/60" />
                      <div className="absolute inset-0 bg-primary/20 flex flex-col items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity">
                        <Icon name="upload" className="text-primary text-lg" />
                        <span className="text-[8px] text-primary uppercase font-bold">Avatar</span>
                      </div>
                    </>
                  )}
                </FileUploader>
              </div>
            </div>

            <div className="pt-8 space-y-6">
              {/* Bio */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] uppercase tracking-widest text-primary font-bold font-mono">Bio <span className="text-red-400">*</span></label>
                  <span className="text-[10px] text-on-surface-variant/60 font-mono">{bio.length}/500</span>
                </div>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value.slice(0, 500))}
                  className={`w-full bg-background border focus:border-primary focus:ring-0 text-on-surface placeholder:text-on-surface-variant/30 p-4 transition-all min-h-[100px] resize-none font-mono text-sm ${
                    bio.length > 0 && bio.trim().length < 10 ? "border-red-400/50" : "border-outline"
                  }`}
                  placeholder="Tell the world something about yourself without revealing who you are"
                />
                {bio.length > 0 && bio.trim().length < 10 && (
                  <p className="text-[10px] text-red-400/80 font-mono">
                    Bio must be at least 10 characters
                  </p>
                )}
              </div>

              {/* Gender + Age row */}
              <div className="flex gap-4">
                <div className="flex-1 space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-primary font-bold font-mono">Gender</label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value as Gender | "")}
                    className="w-full bg-background border border-outline focus:border-primary focus:ring-0 text-on-surface p-4 font-mono text-sm appearance-none cursor-pointer"
                  >
                    <option value="">Select...</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="flex-1 space-y-3">
                  <label className="text-[10px] uppercase tracking-widest text-primary font-bold font-mono">
                    Age <span className="text-on-surface-variant/60">(optional)</span>
                  </label>
                  <input
                    type="number"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    className="w-full bg-background border border-outline focus:border-primary focus:ring-0 text-on-surface p-4 font-mono text-sm"
                    placeholder="Age"
                    min="13"
                    max="150"
                  />
                </div>
              </div>

              {/* Save button */}
              <button
                onClick={handleSaveProfile}
                disabled={bio.trim().length < 10}
                className="w-full bg-primary text-black py-4 font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-3 hover:bg-primary/90 transition-all matrix-button-glow disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Icon name="person_add" className="text-black" />
                <span>Save & Continue</span>
              </button>
            </div>
          </section>
        )}

        {/* ═══ Success Message ═══ */}
        {status === "done" && (
          <section className="space-y-4">
            <div className="border border-primary p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-primary" style={{ boxShadow: "0 0 8px var(--glow-color)" }} />
                <span className="font-bold text-primary matrix-glow">
                  {statusMessage || "All set!"}
                </span>
              </div>
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <SetupPageInner />
    </Suspense>
  );
}
