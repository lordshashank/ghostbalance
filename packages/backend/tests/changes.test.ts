import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createNoopChangeNotifier } from "../src/db/changes.js";

describe("NoopChangeNotifier", () => {
  it("notify does nothing without error", () => {
    const notifier = createNoopChangeNotifier();
    // Should not throw
    notifier.notify("messages", "room-1");
    notifier.notify("users");
  });

  it("onChange returns an unsubscribe function", () => {
    const notifier = createNoopChangeNotifier();
    const unsub = notifier.onChange("messages", () => {
      assert.fail("Should never be called");
    });

    assert.equal(typeof unsub, "function");
    // Should not throw
    unsub();
  });

  it("close resolves without error", async () => {
    const notifier = createNoopChangeNotifier();
    await notifier.close();
  });
});
