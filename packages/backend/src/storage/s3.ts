import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageAdapter } from "./types.js";

interface S3StorageConfig {
  s3Bucket: string;
  s3Region: string;
  s3Endpoint?: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
}

const DEFAULT_UPLOAD_EXPIRES = 300; // 5 minutes
const DEFAULT_DOWNLOAD_EXPIRES = 3600; // 1 hour

export function createS3Storage(config: S3StorageConfig): StorageAdapter {
  const client = new S3Client({
    region: config.s3Region,
    endpoint: config.s3Endpoint,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
  });

  const bucket = config.s3Bucket;

  return {
    async getSignedUploadUrl(key, contentType, contentLength) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ...(contentLength ? { ContentLength: contentLength } : {}),
      });

      return getSignedUrl(client, command, {
        expiresIn: DEFAULT_UPLOAD_EXPIRES,
      });
    },

    async getSignedUrl(key, expiresIn) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      return getSignedUrl(client, command, {
        expiresIn: expiresIn ?? DEFAULT_DOWNLOAD_EXPIRES,
      });
    },

    async exists(key) {
      try {
        await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        );
        return true;
      } catch {
        return false;
      }
    },

    async delete(key) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
    },
  };
}
