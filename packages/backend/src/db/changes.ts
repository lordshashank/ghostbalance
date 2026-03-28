import pg from "pg";

type Unsubscribe = () => void;
type ChangeCallback = (...scope: string[]) => void;

export interface ChangeNotifier {
  notify(resource: string, ...scope: string[]): void;
  onChange(resource: string, callback: ChangeCallback): Unsubscribe;
  close(): Promise<void>;
}

export function createNoopChangeNotifier(): ChangeNotifier {
  return {
    notify() {},
    onChange() {
      return () => {};
    },
    async close() {},
  };
}

const CHANNEL = "_changes";

export async function createPostgresChangeNotifier(
  databaseUrl: string
): Promise<ChangeNotifier> {
  // Dedicated connection for LISTEN (can't use pooled connections)
  const listener = new pg.Client({ connectionString: databaseUrl });
  await listener.connect();
  await listener.query(`LISTEN ${CHANNEL}`);

  // Separate pool for NOTIFY (fire-and-forget writes)
  const notifyPool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

  const subscribers = new Map<string, Set<ChangeCallback>>();

  listener.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      const { resource, scope } = JSON.parse(msg.payload) as {
        resource: string;
        scope: string[];
      };
      const callbacks = subscribers.get(resource);
      if (callbacks) {
        for (const cb of callbacks) cb(...scope);
      }
    } catch {
      // Ignore malformed payloads
    }
  });

  return {
    notify(resource: string, ...scope: string[]) {
      const payload = JSON.stringify({ resource, scope });
      notifyPool
        .query("SELECT pg_notify($1, $2)", [CHANNEL, payload])
        .catch((err) => console.error("[changes] notify error:", err));
    },

    onChange(resource: string, callback: ChangeCallback): Unsubscribe {
      let callbacks = subscribers.get(resource);
      if (!callbacks) {
        callbacks = new Set();
        subscribers.set(resource, callbacks);
      }
      callbacks.add(callback);

      return () => {
        callbacks!.delete(callback);
        if (callbacks!.size === 0) subscribers.delete(resource);
      };
    },

    async close() {
      subscribers.clear();
      await listener.end();
      await notifyPool.end();
    },
  };
}
