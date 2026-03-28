export interface StorageAdapter {
  getSignedUploadUrl(
    key: string,
    contentType: string,
    contentLength?: number
  ): Promise<string>;
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
