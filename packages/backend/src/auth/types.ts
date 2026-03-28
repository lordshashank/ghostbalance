import type { IncomingMessage } from "node:http";

export interface AuthContext {
  userId: string;
  strategy: string;
  sessionId?: string;
  [key: string]: unknown;
}

export interface AuthStrategy {
  name: string;
  authenticate(
    req: IncomingMessage,
    body: Record<string, unknown>
  ): Promise<AuthContext | null>;
}

export type AuthRequirement =
  | "public"
  | { strategy: string; optional?: boolean }
  | Array<{ strategy: string; optional?: boolean }>;
