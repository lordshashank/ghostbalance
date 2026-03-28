import type { RouteConfig } from "../../server/router.js";

export const healthRoute: RouteConfig = {
  method: "GET",
  path: "/health",
  auth: "public",
  handler: async () => {
    return {
      status: 200,
      json: { status: "ok", timestamp: new Date().toISOString() },
    };
  },
};
