import type { Env } from "../env";
import { getDataset, getRun, toReels } from "../integrations/apify";
import { normalizeScraped } from "../integrations/suppliers";
import { j, now } from "../lib/util";
import { processReels } from "./trends";
import { saveCandidates } from "./sourcing";

/** Pulls a finished Apify run's results and feeds them into the right pipeline step. Idempotent. */
export async function processApifyRun(env: Env, rowId: string) {
  const row = await env.DB.prepare("SELECT * FROM apify_runs WHERE id=?").bind(rowId).first<any>();
  if (!row || row.status !== "running") return { skipped: true };
  const run = await getRun(env, row.apify_run_id);
  if (!run || ["READY", "RUNNING"].includes(run.status)) return { still_running: true };

  // claim it so a duplicate webhook + backup poll don't double-process
  const claim = await env.DB.prepare("UPDATE apify_runs SET status='processing' WHERE id=? AND status='running'").bind(rowId).run();
  if (!claim.meta.changes) return { skipped: true };

  const meta = j<any>(row.meta, {});
  try {
    if (run.status !== "SUCCEEDED") throw new Error(`Apify run ${run.status}`);
    const items = await getDataset(env, run.defaultDatasetId);
    let summary: unknown;
    if (meta.kind === "instagram") summary = await processReels(env, toReels(items));
    else if (meta.kind === "supplier") summary = { supplier: meta.supplier, keyword: meta.keyword, saved: await saveCandidates(env, meta.trendId, meta.supplier, normalizeScraped(meta.supplier, items)) };
    await env.DB.prepare("UPDATE apify_runs SET status='done', items=?, summary=?, finished_at=? WHERE id=?")
      .bind(items.length, JSON.stringify(summary ?? {}), now(), rowId).run();
    await env.DB.prepare("INSERT INTO job_runs (id, job, status, summary, finished_at) VALUES (?,?, 'ok', ?, ?)")
      .bind(crypto.randomUUID(), meta.kind === "instagram" ? "trends: results" : `sourcing: ${meta.supplier}`, JSON.stringify({ items: items.length, ...(summary as any) }), now()).run();
    return summary;
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 500);
    await env.DB.prepare("UPDATE apify_runs SET status='failed', summary=?, finished_at=? WHERE id=?").bind(msg, now(), rowId).run();
    await env.DB.prepare("INSERT INTO job_runs (id, job, status, summary, finished_at) VALUES (?,?, 'error', ?, ?)")
      .bind(crypto.randomUUID(), meta.kind === "instagram" ? "trends: results" : `sourcing: ${meta.supplier}`, msg, now()).run();
    return { error: msg };
  }
}

/** Backup for missed webhooks: check any run that's been "running" for 3+ minutes. */
export async function pollStaleRuns(env: Env) {
  const { results } = await env.DB.prepare("SELECT id FROM apify_runs WHERE status='running' AND started_at < ? LIMIT 10").bind(now() - 180).all<any>();
  for (const r of results) await processApifyRun(env, r.id);
  return { checked: results.length };
}
