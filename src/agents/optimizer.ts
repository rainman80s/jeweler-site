import type { Env } from "../env";
import { now, setting } from "../lib/util";

/**
 * Daily: compute per-product funnel over the last N days and act.
 *  - archive products that got enough traffic but don't convert
 *  - feature the top performers on the homepage
 *  - nudge price on high-view / low-ATC items
 *  - approve more candidates from trends that produced winners
 */
export async function optimize(env: Env) {
  const days = await setting<number>(env, "prune_after_days", 14);
  const minViews = await setting<number>(env, "prune_min_views", 150);
  const since = now() - days * 86400;

  const { results } = await env.DB.prepare(`
    SELECT p.id, p.price_cents, p.cost_cents, p.created_at, c.trend_id,
      SUM(e.type='product_view') views, SUM(e.type='add_to_cart') atc, SUM(e.type='purchase') buys,
      COALESCE(SUM(CASE WHEN e.type='purchase' THEN e.value_cents END),0) revenue
    FROM products p LEFT JOIN events e ON e.product_id=p.id AND e.created_at>?
    LEFT JOIN candidates c ON c.id=p.candidate_id
    WHERE p.status='active' GROUP BY p.id`).bind(since).all<any>();

  const actions = { archived: 0, featured: 0, repriced: 0, expanded: 0 };
  const ranked = results.map((r) => ({ ...r, profit: r.buys * (r.price_cents - r.cost_cents), cr: r.views ? r.buys / r.views : 0 }))
    .sort((a, b) => b.profit - a.profit || b.cr - a.cr);

  for (const r of ranked) {
    const age = now() - r.created_at;
    if (age > days * 86400 && r.views >= minViews && r.buys === 0) {
      await env.DB.prepare("UPDATE products SET status='archived', featured=0 WHERE id=?").bind(r.id).run(); actions.archived++;
    } else if (r.views >= minViews && r.atc / r.views < 0.02 && r.price_cents - 300 > r.cost_cents * 2) {
      await env.DB.prepare("UPDATE products SET price_cents=price_cents-300, updated_at=? WHERE id=?").bind(now(), r.id).run(); actions.repriced++;
    }
  }
  await env.DB.prepare("UPDATE products SET featured=0").run();
  for (const r of ranked.slice(0, 8)) {
    await env.DB.prepare("UPDATE products SET featured=1 WHERE id=?").bind(r.id).run(); actions.featured++;
  }
  // Double down: winners' trends get their next-best candidate approved
  for (const r of ranked.filter((x) => x.buys > 0 && x.trend_id).slice(0, 3)) {
    const res = await env.DB.prepare(
      "UPDATE candidates SET status='approved' WHERE id=(SELECT id FROM candidates WHERE trend_id=? AND status='pending' ORDER BY score DESC LIMIT 1)"
    ).bind(r.trend_id).run();
    actions.expanded += res.meta.changes ?? 0;
  }
  return actions;
}
