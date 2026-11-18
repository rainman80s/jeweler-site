import type { Env } from "../env";
import { SUPPLIERS } from "../integrations/suppliers";
import { retailPrice, setting, uid } from "../lib/util";

/** For the hottest un-sourced trends, search every enabled supplier and score candidates. */
export async function sourceProducts(env: Env, maxTrends = 5) {
  const enabled = await setting<string[]>(env, "suppliers", Object.keys(SUPPLIERS));
  const minMargin = await setting<number>(env, "min_margin", 0.6);
  const markup = parseFloat(env.DEFAULT_MARKUP);
  const { results: trends } = await env.DB.prepare(
    "SELECT * FROM trends WHERE status='new' ORDER BY momentum DESC LIMIT ?").bind(maxTrends).all<any>();

  let found = 0;
  for (const t of trends) {
    await env.DB.prepare("UPDATE trends SET status='sourcing' WHERE id=?").bind(t.id).run();
    for (const name of enabled) {
      const sup = SUPPLIERS[name];
      if (!sup) continue;
      try {
        const items = await sup.search(env, t.keyword, 15);
        for (const p of items) {
          if (!p.costCents || !p.images.length) continue;
          const landed = p.costCents + p.shippingCents;
          const price = retailPrice(landed, markup);
          const margin = (price - landed) / price;
          if (margin < minMargin) continue;
          // Score: margin, social proof, auto-orderable bonus
          const score = margin * 50 + Math.log10((p.orders ?? 0) + 1) * 10 + (p.rating ?? 4) * 4 + (sup.canAutoOrder ? 10 : 0);
          await env.DB.prepare(
            `INSERT OR IGNORE INTO candidates (id,trend_id,supplier,supplier_product_id,supplier_url,title,cost_cents,shipping_cents,ship_days,rating,orders,images,raw,score)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).bind(uid(), t.id, p.supplier, p.id, p.url, p.title, p.costCents, p.shippingCents, p.shipDays ?? null,
                 p.rating ?? null, p.orders ?? null, JSON.stringify(p.images), JSON.stringify(p.raw ?? {}).slice(0, 8000), score).run();
          found++;
        }
      } catch (e) { console.warn(`supplier ${name} failed`, e); }
    }
    await env.DB.prepare("UPDATE trends SET status='sourced' WHERE id=?").bind(t.id).run();
  }

  // Autopilot: auto-approve best candidate per trend
  if (env.AUTO_PUBLISH === "true") {
    await env.DB.prepare(
      `UPDATE candidates SET status='approved' WHERE id IN (
         SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY trend_id ORDER BY score DESC) rn FROM candidates WHERE status='pending') WHERE rn=1)`
    ).run();
  }
  return { trends: trends.length, candidates: found };
}
