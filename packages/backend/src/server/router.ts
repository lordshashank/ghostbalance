import type { IncomingMessage } from "node:http";
import type { DbAdapter } from "../db/pool.js";
import type { ChangeNotifier } from "../db/changes.js";
import type { AuthContext, AuthRequirement } from "../auth/types.js";
import type { StorageAdapter } from "../storage/types.js";

export interface HandlerContext {
  req: IncomingMessage;
  params: Record<string, string>;
  body: Record<string, unknown>;
  db: DbAdapter;
  auth: AuthContext;
  changes: ChangeNotifier;
  storage: StorageAdapter;
}

export interface RouteResponse {
  status: number;
  json: unknown;
  headers?: Record<string, string>;
}

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export interface RouteConfig {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: AuthRequirement;
  rateLimit?: RateLimitConfig;
  validate?: (body: unknown) => boolean;
  handler: (ctx: HandlerContext) => Promise<RouteResponse>;
}

interface CompiledRoute {
  config: RouteConfig;
  regex: RegExp;
  paramNames: string[];
}

export interface Router {
  addRoute(config: RouteConfig): void;
  match(
    method: string,
    url: string
  ): { route: RouteConfig; params: Record<string, string> } | null;
}

function compilePath(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const pattern = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${pattern}$`), paramNames };
}

export function createRouter(): Router {
  const routes: CompiledRoute[] = [];

  return {
    addRoute(config: RouteConfig) {
      const { regex, paramNames } = compilePath(config.path);
      routes.push({ config, regex, paramNames });
    },

    match(method: string, url: string) {
      const pathname = url.split("?")[0];
      for (const { config, regex, paramNames } of routes) {
        if (config.method !== method) continue;
        const match = pathname.match(regex);
        if (!match) continue;

        const params: Record<string, string> = {};
        for (let i = 0; i < paramNames.length; i++) {
          params[paramNames[i]] = decodeURIComponent(match[i + 1]);
        }
        return { route: config, params };
      }
      return null;
    },
  };
}
