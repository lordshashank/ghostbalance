export interface Config {
  port: number;
  databaseUrl: string;
  ethRpcUrl?: string;
  maxBlockAge: number;
  circuitDir?: string;
  errorpingBotToken?: string;
  errorpingChatId?: string;
  errorpingApiKey?: string;
  feedbackAdminKey?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  uploadMaxSize?: number;
  sessionDurationSeconds: number;
  trendingWindowHours: number;
  maxBodySize: number;
  defaultPageLimit: number;
  maxPageLimit: number;
  postMaxLength: number;
  bioMaxLength: number;
  messageMaxLength: number;
  maxPollOptions: number;
}

export function loadConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  return {
    port: parseInt(process.env.PORT || "3001", 10),
    databaseUrl,
    ethRpcUrl: process.env.ETH_RPC_URL || undefined,
    maxBlockAge: process.env.MAX_BLOCK_AGE
      ? parseInt(process.env.MAX_BLOCK_AGE, 10)
      : 256,
    circuitDir: process.env.CIRCUIT_DIR || undefined,
    errorpingBotToken: process.env.ERRORPING_BOT_TOKEN || undefined,
    errorpingChatId: process.env.ERRORPING_CHAT_ID || undefined,
    errorpingApiKey: process.env.ERRORPING_API_KEY || undefined,
    feedbackAdminKey: process.env.FEEDBACK_ADMIN_KEY || undefined,
    s3Bucket: process.env.S3_BUCKET || undefined,
    s3Region: process.env.S3_REGION || undefined,
    s3Endpoint: process.env.S3_ENDPOINT || undefined,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
    uploadMaxSize: process.env.UPLOAD_MAX_SIZE
      ? parseInt(process.env.UPLOAD_MAX_SIZE, 10)
      : undefined,
    sessionDurationSeconds: parseInt(process.env.SESSION_DURATION_SECONDS || "3600", 10),
    trendingWindowHours: parseInt(process.env.TRENDING_WINDOW_HOURS || "24", 10),
    maxBodySize: parseInt(process.env.MAX_BODY_SIZE || "1048576", 10),
    defaultPageLimit: parseInt(process.env.DEFAULT_PAGE_LIMIT || "20", 10),
    maxPageLimit: parseInt(process.env.MAX_PAGE_LIMIT || "50", 10),
    postMaxLength: parseInt(process.env.POST_MAX_LENGTH || "2000", 10),
    bioMaxLength: parseInt(process.env.BIO_MAX_LENGTH || "500", 10),
    messageMaxLength: parseInt(process.env.MESSAGE_MAX_LENGTH || "5000", 10),
    maxPollOptions: parseInt(process.env.MAX_POLL_OPTIONS || "6", 10),
  };
}
