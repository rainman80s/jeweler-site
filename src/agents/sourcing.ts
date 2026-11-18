import type { Env } from "../env";
import { startActor } from "../integrations/apify";
import { SUPPLIERS, actorInput, type SupplierProduct } from "../integrations/suppliers";
import { retailPrice, setting, uid } from "../lib/util";

/**
 * For the hottest un-sourced trends, search every enabled supplier.
 * Direct APIs (CJ, AliExpress with keys) are searched inline; scraper-based suppliers
 * start Apify runs whose results arrive later via webhook -> saveCandidates().
 */
export async function sourceProducts(env: Env, maxTrends = 3) {
  const enabled = await setting<string[]>(env, "suppliers", Object.keys(SUPPLIERS));
  const { results: trends } = await env.DB.prepare(
    "SELECT * FROM trends WHERE status='new' ORDER BY momentum DESC LIMIT ?").bind(maxTrends).all<any>();

  let found = 0, started = 0;
  const errors: string[] = [];
  for (const t of trends) {
    for (const name of enabled) {
      const sup = SUPPLIERS[name];
      if (!sup) continue;
      try {
        const direct = sup.search ? await sup.search(env, t.keyword, 15) : null;
        if (direct) found += await saveCandidates(env, t.id, name, direct);
        else if (sup.actor) { await startActor(env, sup.actor, actorInput(name, t.keyword), { kind: "supplier", supplier: name, trendId: t.id, keyword: t.keyword }); started++; }
      } catch (e: any) { errors.push(`${name}: ${String(e?.message ?? e).slice(0, 160)}`); }
    }
    await env.DB.prepare("UPDATE trends SET status='sourced' WHERE id=?").bind(t.id).run();
  }
  return { trends: trends.map((t) => t.keyword), candidates_now: found, scrapes_started: started, errors };
}

/** Scores and stores supplier products for a trend. Returns how many passed the filters. */
export async function saveCandidates(env: Env, trendId: string, supplierName: string, items: SupplierProduct[]) {
  const minMargin = await setting<number>(env, "min_margin", 0.6);
  const markup = parseFloat(env.DEFAULT_MARKUP);
  const sup = SUPPLIERS[supplierName];
  let n = 0;
  for (const p of items) {
    if (!p.costCents || !p.images.length || !p.title) continue;
    const landed = p.costCents + p.shippingCents;
    const price = retailPrice(landed, markup);
    const margin = (price - landed) / price;
    if (margin < minMargin) continue;
    // Score: margin, social proof, auto-orderable bonus
    const score = margin * 50 + Math.log10((p.orders ?? 0) + 1) * 10 + (p.rating ?? 4) * 4 + (sup?.canAutoOrder ? 10 : 0);
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO candidates (id,trend_id,supplier,supplier_product_id,supplier_url,title,cost_cents,shipping_cents,ship_days,rating,orders,images,raw,score)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(uid(), trendId, p.supplier, p.id, p.url, p.title, p.costCents, p.shippingCents, p.shipDays ?? null,
           p.rating ?? null, p.orders ?? null, JSON.stringify(p.images), JSON.stringify(p.raw ?? {}).slice(0, 8000), score).run();
    n += r.meta.changes ?? 0;
  }
  // Autopilot: auto-approve the best candidate for this trend
  if (env.AUTO_PUBLISH === "true") {
    await env.DB.prepare(
      `UPDATE candidates SET status='approved' WHERE id=(SELECT id FROM candidates WHERE trend_id=? AND status='pending' ORDER BY score DESC LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM candidates WHERE trend_id=? AND status IN ('approved','listed'))`
    ).bind(trendId, trendId).run();
  }
  return n;
}
