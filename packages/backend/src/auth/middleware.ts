import type { IncomingMessage } from "node:http";
import type { AuthStrategy, AuthContext, AuthRequirement } from "./types.js";

export interface AuthMiddleware {
  registerStrategy(strategy: AuthStrategy): void;
  authenticate(
    req: IncomingMessage,
    body: Record<string, unknown>,
    requirement: AuthRequirement
  ): Promise<AuthContext | null | false>;
}

export function createAuthMiddleware(): AuthMiddleware {
  const strategies = new Map<string, AuthStrategy>();

  return {
    registerStrategy(strategy: AuthStrategy) {
      strategies.set(strategy.name, strategy);
    },

    async authenticate(
      req: IncomingMessage,
      body: Record<string, unknown>,
      requirement: AuthRequirement
    ): Promise<AuthContext | null | false> {
      // null = public route, no auth needed
      if (requirement === "public") return null;

      const requirements = Array.isArray(requirement)
        ? requirement
        : [requirement];

      for (const { strategy: name } of requirements) {
        const strategy = strategies.get(name);
        if (!strategy) continue;

        const result = await strategy.authenticate(req, body);
        if (result) return result;
      }

      // If any requirement was optional, allow unauthenticated access
      if (requirements.some((r) => r.optional)) return null;

      return false;
    },
  };
}
