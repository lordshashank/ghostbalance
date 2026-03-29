"use client";

import { useRouter } from "next/navigation";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";

export default function AboutPage() {
  const router = useRouter();

  return (
    <AppLayout>
      <PageHeader
        title="About"
        subtitle="GhostBalance Protocol"
        showBack
        onBack={() => router.back()}
      />

      <div className="p-6 space-y-8">
        {/* What is GhostBalance? */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <Icon name="terminal" className="text-primary text-2xl" />
            <h2 className="text-xl font-bold text-primary matrix-glow">
              What is GhostBalance?
            </h2>
          </div>
          <p className="text-base leading-relaxed font-mono text-on-surface-variant">
            GhostBalance is a privacy-first social platform where your identity is
            your ETH balance — not your name, email, or wallet address. Using
            zero-knowledge proofs, you can prove you hold a certain amount of ETH
            without ever revealing which wallet it comes from. Our backend only ever
            sees your pseudonymous nullifier — never your address, never your keys,
            never your real identity.
          </p>
        </section>

        {/* Why GhostBalance? */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <Icon name="lightbulb" className="text-primary text-2xl" />
            <h2 className="text-xl font-bold text-primary matrix-glow">
              Why GhostBalance?
            </h2>
          </div>
          <p className="text-base leading-relaxed font-mono text-on-surface-variant">
            Satoshi holds over a million Bitcoin but can&apos;t use it, can&apos;t
            speak up, can&apos;t engage — because one move reveals who he is. The
            bigger your bag, the more you are reluctant to reveal it.
          </p>
          <p className="text-base leading-relaxed font-mono text-on-surface-variant">
          So we thought of solving this in Ethereum.
          </p>
          <p className="text-base leading-relaxed font-mono text-on-surface-variant">
            Speak freely, backed by your proven
            balance, without ever revealing who you are, not to us, not to anyone. Your wallet stays yours.
            Your voice stays anonymous. Your balance speaks for itself.
          </p>
        </section>

        {/* How it works */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <Icon name="settings" className="text-primary text-2xl" />
            <h2 className="text-xl font-bold text-primary matrix-glow">
              How It Works
            </h2>
          </div>
          <div className="space-y-5">
            <div className="border-l-2 border-primary pl-4">
              <p className="text-sm font-bold text-primary mb-1">1. Connect & Sign</p>
              <p className="text-base leading-relaxed font-mono text-on-surface-variant">
                You connect your wallet and sign a fixed message. This signature,
                combined with a nullifier seed, generates your nullifier — your
                permanent anonymous identity on the platform.
              </p>
            </div>
            <div className="border-l-2 border-primary pl-4">
              <p className="text-sm font-bold text-primary mb-1">2. Prove in Browser</p>
              <p className="text-base leading-relaxed font-mono text-on-surface-variant">
                A zero-knowledge proof is generated entirely in your browser. It
                verifies that you hold at least the amount of ETH you&apos;re
                claiming, without exposing your actual balance or wallet address.
              </p>
            </div>
            <div className="border-l-2 border-primary pl-4">
              <p className="text-sm font-bold text-primary mb-1">3. Backend Verification</p>
              <p className="text-base leading-relaxed font-mono text-on-surface-variant">
                The proof is sent to our backend, which can only verify its
                validity. It has no way to determine which address produced it. We
                only ever see your nullifier — never your wallet.
              </p>
            </div>
            <div className="border-l-2 border-primary pl-4">
              <p className="text-sm font-bold text-primary mb-1">4. Choose Your Balance</p>
              <p className="text-base leading-relaxed font-mono text-on-surface-variant">
                You can sign up with any balance less than or equal to your actual
                on-chain balance. Since many wallets hold similar amounts, your
                chosen balance alone isn&apos;t enough to identify you.
              </p>
            </div>
          </div>
        </section>

        {/* Nullifier Seed & Recovery */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <Icon name="key" className="text-primary text-2xl" />
            <h2 className="text-xl font-bold text-primary matrix-glow">
              Nullifier Seed & Recovery
            </h2>
          </div>
          <p className="text-base leading-relaxed font-mono text-on-surface-variant">
            Your nullifier seed is the second ingredient (along with your wallet
            signature) that determines your identity.
          </p>
          <p className="text-base leading-relaxed font-mono text-on-surface-variant">
            By default, we use your signup balance as the seed. This lets you
            smoothly update your displayed balance over time without losing your
            identity — as your on-chain balance changes, you can reprove with a new
            amount and your profile stays the same, since the nullifier seed remains
            your initial balance.
          </p>
          <p className="text-base leading-relaxed font-mono text-on-surface-variant">
            For users who want full control, we provide the option to set a custom
            seed instead. If you do, you&apos;ll need to remember it to recover your
            account on a new device (we store it in your browser&apos;s local
            storage, but nowhere else).
          </p>
          <p className="text-base leading-relaxed font-mono text-on-surface-variant">
            The seed acts as a second layer of anonymity: even if someone somehow
            obtained your signature, they would also need the exact nullifier seed
            to reconstruct your identity.
          </p>
        </section>

        {/* Open Source */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <Icon name="code" className="text-primary text-2xl" />
            <h2 className="text-xl font-bold text-primary matrix-glow">
              Open Source
            </h2>
          </div>
          <p className="text-base leading-relaxed font-mono text-on-surface-variant">
            A privacy protocol can&apos;t be trusted to be private unless all of
            its code is open source. GhostBalance is fully open source — circuits,
            backend, and frontend. Verify everything yourself:{" "}
            <a
              href="https://github.com/lordshashank/ghostbalance"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary-glow transition-colors underline"
            >
              github.com/lordshashank/ghostbalance
            </a>
          </p>
        </section>
      </div>
    </AppLayout>
  );
}
