import type { Env } from "../env";
import { logJob } from "../lib/util";
import { scanTrends } from "./trends";
import { sourceProducts } from "./sourcing";
import { buildListings } from "./listing";
import { optimize } from "./optimizer";
import { makeCreatives } from "./marketing";

export const JOBS: Record<string, (env: Env) => Promise<unknown>> = {
  trends: scanTrends,
  sourcing: (e) => sourceProducts(e),
  listing: (e) => buildListings(e),
  optimize,
  marketing: (e) => makeCreatives(e),
};

const CRON_MAP: Record<string, keyof typeof JOBS> = {
  "0 */6 * * *": "trends",
  "30 */6 * * *": "sourcing",
  "0 */2 * * *": "listing",
  "0 9 * * *": "optimize",
  "0 10 * * 1": "marketing",
};

export async function runCron(cron: string, env: Env) {
  const job = CRON_MAP[cron];
  if (job) await logJob(env, job, () => JOBS[job](env));
}
