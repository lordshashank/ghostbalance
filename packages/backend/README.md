# backend-template

Minimal, production-ready Node.js backend template. Raw `node:http`, PostgreSQL, optional WebSocket — no framework overhead.

## What you get

- **HTTP server** with JSON request/response pipeline
- **PostgreSQL** with parameterized queries and auto-migrations
- **Authentication** — cookie sessions, SIWE (Ethereum), bearer tokens
- **Rate limiting** — in-memory sliding window, per-route configurable
- **Real-time** — WebSocket invalidation via Postgres LISTEN/NOTIFY (optional)
- **Error tracking** — receive errors from frontends, store in Postgres, forward to Telegram (optional)
- **File storage** — S3-compatible uploads (Cloudflare R2, AWS S3, MinIO) via presigned URLs (optional)
- **Feedback forum** — users submit bugs/feature requests, vote, comment; admin manages status via bearer auth (optional)
- **Docker Compose** — Postgres + app with hot reload, one command to start

Zero external frameworks. ESM throughout. TypeScript strict mode.

## Quick start

```bash
git clone https://github.com/lordshashank/backend-template.git my-app
cd my-app
cp .env.example .env     # edit with your values
npm install
docker compose up
```

The template ships with all features included. Keep what you need, remove what you don't.

## Customizing

The template includes everything out of the box: multiple auth strategies, real-time WebSocket, error tracking, example CRUD routes. You probably don't need all of it.

Run `/setup` in your AI agent — it will ask which features you want and remove the rest.

Or manually tell your agent which features to remove. The codebase is structured so features are self-contained and cleanly removable.

Features that can be removed independently:

| Feature | What to remove |
|---|---|
| **SIWE auth** | `src/auth/strategies/siwe.ts` + its registration in `src/index.ts` |
| **JWT auth** | `src/auth/strategies/jwt.ts` + its registration in `src/index.ts` |

| **Cookie auth** | `src/auth/strategies/cookie.ts`, `src/auth/session.ts`, `migrations/001_sessions.sql` |
| **Bearer auth** | `src/auth/strategies/bearer.ts` + its registration in `src/index.ts` |
| **Real-time** | `src/server/ws.ts` + `ENABLE_REALTIME` block in `src/index.ts` |
| **Errorping** | `src/app/routes/errorping.ts`, `migrations/003_error_events.sql` + `ENABLE_ERRORPING` block in `src/index.ts` |
| **Feedback** | `src/app/routes/feedback.ts`, `migrations/004_feedback.sql` + `ENABLE_FEEDBACK` block in `src/index.ts` |
| **Storage** | `src/storage/`, `src/app/routes/uploads.ts`, `migrations/005_uploads.sql` + `ENABLE_STORAGE` block in `src/index.ts` |
| **Example routes** | `src/app/routes/messages.ts`, `src/app/routes/auth-routes.ts`, `migrations/002_messages.sql` |

## Request pipeline

Every request flows through:

```
Route match → Rate limit → Parse body → Validate → Authenticate → Handler → JSON response
```

## Defining routes

Routes live in `src/app/routes/`. Each exports a `RouteConfig` or `RouteConfig[]`:

```ts
import type { RouteConfig } from "../../server/router.js";

export const myRoute: RouteConfig = {
  method: "GET",
  path: "/items/:id",
  auth: "public",
  handler: async (ctx) => {
    const result = await ctx.db.query(
      "SELECT * FROM items WHERE id = $1",
      [ctx.params.id]
    );
    return { status: 200, json: result.rows[0] ?? null };
  },
};
```

Register routes in `src/index.ts`:

```ts
router.addRoute(myRoute);
```

### Handler context

Every handler receives:

| Field | Type | Description |
|---|---|---|
| `req` | `IncomingMessage` | Raw HTTP request |
| `params` | `Record<string, string>` | URL path params (`:id` → `params.id`) |
| `body` | `Record<string, unknown>` | Parsed JSON body |
| `db` | `DbAdapter` | `query()` and `transaction()` |
| `auth` | `AuthContext` | Authenticated user info |
| `changes` | `ChangeNotifier` | Real-time invalidation (or no-op) |
| `storage` | `StorageAdapter` | File storage — presigned URLs (or no-op) |

### Auth options

```ts
auth: "public"                          // no auth required
auth: { strategy: "cookie" }            // require cookie session
auth: { strategy: "bearer" }            // require bearer token
auth: [{ strategy: "cookie" }, { strategy: "bearer" }]  // either works
```

### Per-route rate limiting

```ts
rateLimit: { windowMs: 60_000, max: 20 }  // 20 requests per minute
```

## Migrations

SQL files in `migrations/`, numbered for ordering:

```
migrations/
  001_sessions.sql
  002_messages.sql
```

Auto-run on startup. Each runs in a transaction. Tracked in a `_migrations` table — already-applied migrations are skipped.

## Authentication strategies

| Strategy | How it works |
|---|---|
| **Cookie** | Session-based. `POST /auth/login` creates a session, sets `session` cookie. Sessions stored in Postgres. |
| **SIWE** | Sign-In With Ethereum. Verifies signed message, creates session. Uses `siwe` + `ethers` packages. |
| **JWT** | Stateless token auth via `Authorization: Bearer <token>`. Verifies signature + expiry, no DB lookup. Uses `jsonwebtoken` package. |
| **Bearer** | Static token via `Authorization: Bearer <token>` header. Good for API keys, CLI access, service-to-service. |

## Optional features

### Real-time (WebSocket)

Set `ENABLE_REALTIME=true`. Starts a WebSocket server on `WS_PORT`. Routes call `ctx.changes.notify("resource")` to signal changes. Connected clients subscribe to resources and receive invalidation messages.

```ts
// In a route handler — notify after a mutation
ctx.changes.notify("messages");

// Client-side WebSocket message
{ "subscribe": "messages" }
// Server pushes when data changes
{ "invalidate": ["messages"] }
```

### Errorping (error tracking)

Set `ENABLE_ERRORPING=true`. Provides routes for receiving frontend errors, storing them in Postgres, and forwarding to Telegram.

| Route | Auth | Purpose |
|---|---|---|
| `POST /errorping` | Public | Receive errors from frontend |
| `GET /errorping` | Bearer | Query errors with filters |
| `GET /errorping/summary` | Bearer | Errors grouped by fingerprint |
| `POST /errorping/resolve` | Bearer | Mark fingerprint resolved |
| `POST /errorping/unresolve` | Bearer | Mark fingerprint unresolved |

Pair with the [errorping](https://github.com/lordshashank/errorping) frontend library to capture browser errors and send them to your backend.

Environment variables:

```
ENABLE_ERRORPING=true
ERRORPING_BOT_TOKEN=your_telegram_bot_token
ERRORPING_CHAT_ID=your_telegram_chat_id
ERRORPING_API_KEY=your_secret_api_key
```

### Feedback (user feedback forum)

Set `ENABLE_FEEDBACK=true`. Lets authenticated users submit bug reports, feature requests, vote, and comment. Admin manages post status via bearer auth.

| Route | Auth | Purpose |
|---|---|---|
| `POST /feedback` | User | Create a feedback post (bug, feature, improvement, question) |
| `GET /feedback` | User | List posts with filters (`?status`, `?type`, `?sort=votes\|recent`, `?page`, `?limit`) |
| `GET /feedback/:id` | User | Get post with comments |
| `POST /feedback/:id/vote` | User | Toggle upvote |
| `POST /feedback/:id/comments` | User / Bearer | Add comment (`is_admin=true` for bearer) |
| `DELETE /feedback/:id` | User / Bearer | Delete own post (user) or any post (admin) |
| `DELETE /feedback/:id/comments/:commentId` | User / Bearer | Delete own comment (user) or any comment (admin) |
| `PATCH /feedback/:id/status` | Bearer | Update status, priority, admin_note, duplicate_of |

Environment variables:

```
ENABLE_FEEDBACK=true
FEEDBACK_ADMIN_KEY=your_secret_admin_key
```

### Storage (file uploads)

Set `ENABLE_STORAGE=true`. Provides routes for uploading and serving files via S3-compatible presigned URLs. The server never handles file bytes — clients upload directly to the storage backend.

Upload lifecycle is two-phase:
- `POST /uploads` prepares upload metadata and returns a presigned URL
- client uploads directly to storage with `PUT`
- `POST /uploads/:key/complete` verifies object exists and marks upload `completed`

Upload records move through status values:
- `pending` -> `completed` for successful uploads
- `deleting` when object deletion fails;

Works with Cloudflare R2, AWS S3, MinIO, or any S3-compatible service.

| Route | Auth | Purpose |
|---|---|---|
| `GET /uploads` | User | List own uploads |
| `POST /uploads` | User | Request presigned upload URL. Body: `{ contentType, filename, fileSize }` |
| `POST /uploads/:key/complete` | User | Finalize upload after successful client `PUT` |
| `GET /uploads/:key` | User | Get presigned download URL |
| `DELETE /uploads/:key` | User | Delete own upload; may return `{ ok: true, deleting: true }` on storage delete failure |

Environment variables:

```
ENABLE_STORAGE=true
S3_BUCKET=my-bucket
S3_REGION=auto
S3_ENDPOINT=https://your-account.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key
UPLOAD_MAX_SIZE=10485760    # optional, default 10MB
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Postgres connection string |
| `PORT` | No | 3001 | HTTP server port |
| `CORS_ORIGIN` | No | — | Allowed origin for CORS |
| `ENABLE_REALTIME` | No | false | Enable WebSocket server |
| `WS_PORT` | No | 3002 | WebSocket port (if real-time enabled) |
| `ENABLE_ERRORPING` | No | false | Enable error tracking routes |
| `ERRORPING_BOT_TOKEN` | No | — | Telegram bot token |
| `ERRORPING_CHAT_ID` | No | — | Telegram chat ID |
| `ERRORPING_API_KEY` | No | — | Bearer token for errorping query endpoints |
| `JWT_SECRET` | No | — | Secret key for JWT auth (enables JWT strategy when set) |
| `ENABLE_FEEDBACK` | No | false | Enable feedback forum routes |
| `FEEDBACK_ADMIN_KEY` | No | — | Bearer token for feedback admin endpoints |
| `ENABLE_STORAGE` | No | false | Enable file upload routes |
| `S3_BUCKET` | No | — | S3 bucket name (required if storage enabled) |
| `S3_REGION` | No | — | S3 region (use `auto` for R2) |
| `S3_ENDPOINT` | No | — | S3 endpoint URL (required for R2/MinIO) |
| `S3_ACCESS_KEY_ID` | No | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | No | — | S3 secret key |
| `UPLOAD_MAX_SIZE` | No | 10485760 | Max upload size in bytes (default 10MB) |

## Project structure

```
src/
  index.ts                  # Entry point — wires everything together
  config.ts                 # Environment config loader
  app/routes/               # Your routes go here
  auth/                     # Auth middleware + strategies
  db/                       # Postgres adapter, migrations, change notifier
  storage/                  # S3-compatible storage adapter
  server/                   # HTTP server, router, WebSocket
  rate-limit/               # Sliding window rate limiter
migrations/                 # Numbered SQL migration files
tests/                      # Node.js built-in test runner
docker-compose.yml          # Postgres + app with hot reload
Dockerfile                  # Multi-stage build (dev + prod)
```

## Scripts

```bash
npm run dev       # Hot reload development server
npm run build     # TypeScript → dist/
npm start         # Run production build
npm test          # Run all tests
```

## License

MIT
