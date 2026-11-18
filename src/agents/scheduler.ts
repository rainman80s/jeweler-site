import type { Env } from "../env";
import { logJob } from "../lib/util";
import { scanTrends } from "./trends";
import { sourceProducts } from "./sourcing";
import { buildListings } from "./listing";
import { optimize } from "./optimizer";
import { makeCreatives } from "./marketing";
import { pollStaleRuns } from "./apifyRuns";

export const JOBS: Record<string, (env: Env) => Promise<unknown>> = {
  trends: scanTrends,
  sourcing: (e) => sourceProducts(e),
  listing: (e) => buildListings(e),
  optimize,
  marketing: (e) => makeCreatives(e),
};

/**
 * Hourly cron -> job plan (UTC hours):
 *  trends    every 6h  (0, 6, 12, 18)
 *  sourcing  every 6h  (1, 7, 13, 19)
 *  listing   every 2h  (odd hours, after sourcing)
 *  optimize  daily at 09:00
 *  marketing Mondays at 10:00
 */
export function jobsForHour(d: Date): (keyof typeof JOBS)[] {
  const h = d.getUTCHours();
  const out: (keyof typeof JOBS)[] = [];
  if (h % 6 === 0) out.push("trends");
  if (h % 6 === 1) out.push("sourcing");
  if (h % 2 === 1) out.push("listing");
  if (h === 9) out.push("optimize");
  if (h === 10 && d.getUTCDay() === 1) out.push("marketing");
  return out;
}

export async function runCron(scheduledTime: number, env: Env) {
  await pollStaleRuns(env); // pick up any scrape whose webhook was missed
  for (const job of jobsForHour(new Date(scheduledTime))) await logJob(env, job, () => JOBS[job](env));
}
