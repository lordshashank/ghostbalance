import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

describe("Config", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("loads config from env vars", () => {
    process.env.DATABASE_URL = "postgres://localhost:5432/test";
    process.env.PORT = "4000";
    process.env.ETH_RPC_URL = "https://rpc.example.com";
    process.env.MAX_BLOCK_AGE = "512";

    const config = loadConfig();
    assert.equal(config.databaseUrl, "postgres://localhost:5432/test");
    assert.equal(config.port, 4000);
    assert.equal(config.ethRpcUrl, "https://rpc.example.com");
    assert.equal(config.maxBlockAge, 512);
  });

  it("uses default values", () => {
    process.env.DATABASE_URL = "postgres://localhost:5432/test";
    delete process.env.PORT;
    delete process.env.MAX_BLOCK_AGE;
    delete process.env.ETH_RPC_URL;

    const config = loadConfig();
    assert.equal(config.port, 3001);
    assert.equal(config.maxBlockAge, 256);
    assert.equal(config.ethRpcUrl, undefined);
  });

  it("throws when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;

    assert.throws(() => loadConfig(), {
      message: "DATABASE_URL environment variable is required",
    });
  });
});
