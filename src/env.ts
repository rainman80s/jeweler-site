export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  STORE_NAME: string;
  CURRENCY: string;
  DEFAULT_MARKUP: string;
  AUTO_PUBLISH: string;
  APIFY_TOKEN?: string;
  OPENAI_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  ALIEXPRESS_APP_KEY?: string;
  ALIEXPRESS_APP_SECRET?: string;
  ALIEXPRESS_ACCESS_TOKEN?: string;
  CJ_API_KEY?: string;
  ADMIN_BOOTSTRAP_EMAIL?: string;
  ADMIN_BOOTSTRAP_PASSWORD?: string;
}
