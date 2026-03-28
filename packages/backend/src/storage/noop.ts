import type { StorageAdapter } from "./types.js";

export function createNoopStorage(): StorageAdapter {
  const err = () => {
    throw new Error("Storage not enabled");
  };
  return {
    getSignedUploadUrl: err,
    getSignedUrl: err,
    exists: err,
    delete: err,
  };
}
