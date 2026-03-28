import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createNoopStorage } from "../src/storage/noop.js";

describe("NoopStorage", () => {
  it("getSignedUploadUrl throws", () => {
    const storage = createNoopStorage();
    assert.throws(
      () => storage.getSignedUploadUrl("key", "image/png"),
      { message: "Storage not enabled" }
    );
  });

  it("getSignedUrl throws", () => {
    const storage = createNoopStorage();
    assert.throws(
      () => storage.getSignedUrl("key"),
      { message: "Storage not enabled" }
    );
  });

  it("delete throws", () => {
    const storage = createNoopStorage();
    assert.throws(
      () => storage.delete("key"),
      { message: "Storage not enabled" }
    );
  });

  it("exists throws", () => {
    const storage = createNoopStorage();
    assert.throws(
      () => storage.exists("key"),
      { message: "Storage not enabled" }
    );
  });
});
