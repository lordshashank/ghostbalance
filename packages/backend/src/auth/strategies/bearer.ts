import type { AuthStrategy, AuthContext } from "../types.js";

export function createBearerStrategy(token: string): AuthStrategy {
  return {
    name: "bearer",
    async authenticate(req): Promise<AuthContext | null> {
      const header = req.headers.authorization;
      if (!header) return null;

      const [scheme, value] = header.split(" ", 2);
      if (scheme !== "Bearer" || value !== token) return null;

      return { userId: "bearer", strategy: "bearer" };
    },
  };
}
