import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "./config.js";
import { createPostgresAdapter } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { createAuthMiddleware } from "./auth/middleware.js";
import { createSessionStrategy } from "./auth/strategies/session.js";
import { createRateLimiter } from "./rate-limit/limiter.js";
import { createNoopChangeNotifier } from "./db/changes.js";
import { createNoopStorage } from "./storage/noop.js";
import { createRouter } from "./server/router.js";
import { createHttpServer } from "./server/http.js";
import { healthRoute } from "./app/routes/health.js";
import { createProfileRoutes } from "./app/routes/profiles.js";
import { createPostRoutes } from "./app/routes/posts.js";
import { likeRoutes } from "./app/routes/likes.js";
import { bookmarkRoutes } from "./app/routes/bookmarks.js";
import { followRoutes } from "./app/routes/follows.js";
import { pollRoutes } from "./app/routes/polls.js";
import { createConversationRoutes } from "./app/routes/conversations.js";
import { notificationRoutes } from "./app/routes/notifications.js";
import { blockRoutes } from "./app/routes/blocks.js";
import { leaderboardRoutes } from "./app/routes/leaderboard.js";
import { createTrendingRoutes } from "./app/routes/trending.js";

async function main() {
  const config = loadConfig();

  // Database
  const db = createPostgresAdapter(config.databaseUrl);
  await runMigrations(db, "./migrations");

  // Auth
  const auth = createAuthMiddleware();

  // Session auth (cookie-based, for all authenticated routes)
  auth.registerStrategy(createSessionStrategy(db));

  // ZK Proof auth (only for /auth/verify and /profiles/reprove)
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const zkproofConfig = config.ethRpcUrl
    ? {
        circuitDir: config.circuitDir || resolve(__dirname, "../circuits"),
        ethRpcUrl: config.ethRpcUrl,
        maxBlockAge: config.maxBlockAge,
      }
    : null;

  if (zkproofConfig) {
    const { createZkProofStrategy } = await import(
      "./auth/strategies/zkproof/index.js"
    );
    auth.registerStrategy(createZkProofStrategy(zkproofConfig));
    console.log("[auth] ZK proof + session strategies registered");
  }

  // Rate limiting
  const rateLimiter = createRateLimiter();

  // Change notifier
  const changes = createNoopChangeNotifier();

  // Storage (set ENABLE_STORAGE=true to activate)
  let storage;
  if (process.env.ENABLE_STORAGE === "true") {
    const { createS3Storage } = await import("./storage/s3.js");
    storage = createS3Storage({
      s3Bucket: config.s3Bucket!,
      s3Region: config.s3Region!,
      s3Endpoint: config.s3Endpoint,
      s3AccessKeyId: config.s3AccessKeyId!,
      s3SecretAccessKey: config.s3SecretAccessKey!,
    });
  } else {
    storage = createNoopStorage();
  }

  // Router
  const router = createRouter();
  router.addRoute(healthRoute);

  // Auth verify (login) endpoint
  if (zkproofConfig) {
    const { createAuthVerifyRoute } = await import("./app/routes/auth.js");
    router.addRoute(createAuthVerifyRoute(zkproofConfig, config.sessionDurationSeconds));
  }

  // Auth session routes (me + logout)
  const { authMeRoute, authLogoutRoute } = await import("./app/routes/auth.js");
  router.addRoute(authMeRoute);
  router.addRoute(authLogoutRoute);

  // Core routes
  const profileRoutes = createProfileRoutes({
    sessionDurationSeconds: config.sessionDurationSeconds,
    bioMaxLength: config.bioMaxLength,
  });
  for (const route of profileRoutes) router.addRoute(route);
  const postRoutes = createPostRoutes({
    postMaxLength: config.postMaxLength,
    maxPollOptions: config.maxPollOptions,
  });
  for (const route of postRoutes) router.addRoute(route);
  for (const route of likeRoutes) router.addRoute(route);
  for (const route of bookmarkRoutes) router.addRoute(route);
  for (const route of followRoutes) router.addRoute(route);
  for (const route of pollRoutes) router.addRoute(route);

  // Social routes
  const conversationRoutes = createConversationRoutes({
    messageMaxLength: config.messageMaxLength,
  });
  for (const route of conversationRoutes) router.addRoute(route);
  for (const route of notificationRoutes) router.addRoute(route);
  for (const route of blockRoutes) router.addRoute(route);

  // Discovery routes
  for (const route of leaderboardRoutes) router.addRoute(route);
  const trendingRoutes = createTrendingRoutes({
    trendingWindowHours: config.trendingWindowHours,
  });
  for (const route of trendingRoutes) router.addRoute(route);

  // Errorping routes (set ENABLE_ERRORPING=true to activate)
  if (process.env.ENABLE_ERRORPING === "true") {
    const { createBearerStrategy } = await import(
      "./auth/strategies/bearer.js"
    );
    if (config.errorpingApiKey) {
      auth.registerStrategy(createBearerStrategy(config.errorpingApiKey));
    }

    const { createErrorpingRoutes } = await import(
      "./app/routes/errorping.js"
    );
    for (const route of createErrorpingRoutes({
      botToken: config.errorpingBotToken!,
      chatId: config.errorpingChatId!,
    }))
      router.addRoute(route);
  }

  // Upload routes (set ENABLE_STORAGE=true to activate)
  if (process.env.ENABLE_STORAGE === "true") {
    const { createUploadRoutes } = await import("./app/routes/uploads.js");
    for (const route of createUploadRoutes({
      auth: { strategy: "session" },
      maxSizeBytes: config.uploadMaxSize,
    }))
      router.addRoute(route);
  }

  // Feedback routes (set ENABLE_FEEDBACK=true to activate)
  if (process.env.ENABLE_FEEDBACK === "true") {
    const { createBearerStrategy } = await import(
      "./auth/strategies/bearer.js"
    );
    if (config.feedbackAdminKey) {
      auth.registerStrategy(createBearerStrategy(config.feedbackAdminKey));
    }

    const { createFeedbackRoutes } = await import(
      "./app/routes/feedback.js"
    );
    for (const route of createFeedbackRoutes({
      userAuth: { strategy: "session" },
    }))
      router.addRoute(route);
  }

  // HTTP server
  const server = createHttpServer({
    port: config.port,
    router,
    db,
    changes,
    auth,
    rateLimiter,
    storage,
    corsOrigin: process.env.CORS_ORIGIN,
    maxBodySize: config.maxBodySize,
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[app] Shutting down...");
    server.close();
    await changes.close();
    await db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[app] Fatal error:", err);
  process.exit(1);
});
