"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Profile } from "@/lib/types";
import { loadProofBundle } from "@/lib/proofStore";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface AuthContextValue {
  user: Profile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  refreshProfile: async () => {},
  logout: async () => {},
});

// Raw fetch — no interceptors, no events, no loops
async function rawGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function rawPost<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Run once on mount: ensure session exists if proofs exist
  useEffect(() => {
    let cancelled = false;

    async function initAuth() {
      // 1. Try existing session
      const profile = await rawGet<Profile>("/auth/me");
      if (profile) {
        if (!cancelled) {
          setUser(profile);
          setIsLoading(false);
        }
        return;
      }

      // 2. No session — check for stored proofs
      const bundle = loadProofBundle();
      if (!bundle) {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
        return;
      }

      // 3. Re-establish session with stored proofs
      const verifyResult = await rawPost<{ valid: boolean }>("/auth/verify", {
        proofA: bundle.proofA,
        publicInputsA: bundle.publicInputsA,
        proofB1: bundle.proofB1,
        publicInputsB1: bundle.publicInputsB1,
        proofB2: bundle.proofB2,
        publicInputsB2: bundle.publicInputsB2,
        proofB3: bundle.proofB3,
        publicInputsB3: bundle.publicInputsB3,
        proofB4: bundle.proofB4,
        publicInputsB4: bundle.publicInputsB4,
      });

      if (!verifyResult) {
        // Network error — don't clear proofs, just skip auth
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
        return;
      }

      if (!verifyResult.valid) {
        // Server rejected proofs — keep them locally; a fresh proof will overwrite
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
        return;
      }

      // 4. Session now set — fetch profile
      const retryProfile = await rawGet<Profile>("/auth/me");
      if (!cancelled) {
        setUser(retryProfile);
        setIsLoading(false);
      }
    }

    initAuth();
    return () => { cancelled = true; };
  }, []);

  const refreshProfile = useCallback(async () => {
    const profile = await rawGet<Profile>("/auth/me");
    setUser((prev) => {
      if (prev && profile && prev.nullifier === profile.nullifier && prev.public_balance === profile.public_balance && prev.bio === profile.bio && prev.avatar_key === profile.avatar_key) return prev;
      return profile;
    });
  }, []);

  const logout = useCallback(async () => {
    await rawPost("/auth/logout", {});
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        refreshProfile,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
