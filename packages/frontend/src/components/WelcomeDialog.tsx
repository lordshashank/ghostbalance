"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Icon } from "./Icon";

const WELCOME_KEY = "ghostbalance-welcome-seen";

export function WelcomeDialog() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(WELCOME_KEY)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount check from localStorage
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(WELCOME_KEY, "true");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 z-[110] flex items-start justify-center p-4 bg-black/10 backdrop-blur-sm"
      style={{ minHeight: "100%" }}
      onClick={dismiss}
      data-nosnippet
    >
      <div
        className="glass-panel max-w-sm w-full p-8 mt-32 shadow-2xl border-primary/20 border animate-in fade-in zoom-in duration-500"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center space-y-6">
          {/* Logo/Icon */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 border border-primary/20 text-primary mb-2">
            <Icon name="visibility_off" className="!text-[32px] animate-pulse" />
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-bold text-primary uppercase tracking-[0.3em] font-mono">
              GM, Anon!
            </h3>
            <div className="h-px w-12 bg-primary/30 mx-auto" />
          </div>

          <div className="space-y-4">
            <p className="text-sm font-mono text-on-surface leading-relaxed">
              Welcome to the only social network where your username is
              your ETH balance and no one knows who you are (not even us 😉).
            </p>
            <p className="text-[11px] font-bold text-on-surface/80 uppercase tracking-widest font-mono italic leading-relaxed">
              Let your balance speak, <br /> while you remain invisible.
            </p>
          </div>

          <div className="grid gap-3 pt-4">
            <button
              onClick={dismiss}
              className="w-full py-3 bg-primary text-black text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-all active:scale-95 shadow-[0_0_20px_rgba(var(--color-primary-rgb),0.2)]"
            >
              Enter the Shadows
            </button>
            <Link
              href="/about"
              onClick={dismiss}
              className="w-full py-3 border border-outline text-on-surface-variant text-[10px] font-bold uppercase tracking-widest hover:text-primary hover:border-primary/50 transition-all text-center"
            >
              How it works
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
