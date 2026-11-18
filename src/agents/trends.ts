import type { Env } from "../env";
import { scrapeInstagram } from "../integrations/apify";
import { chatJSON } from "../integrations/openai";
import { now, setting, uid } from "../lib/util";

/**
 * 1) Scrape reels for tracked hashtags/accounts
 * 2) Score each by engagement velocity (engagement per hour since posting)
 * 3) Ask the LLM to extract shoppable style keywords from captions
 * 4) Roll keywords up into `trends` with momentum (decayed running score)
 */
export async function scanTrends(env: Env) {
  const hashtags = await setting<string[]>(env, "hashtags", []);
  const accounts = await setting<string[]>(env, "accounts", []);
  const reels = await scrapeInstagram(env, hashtags, accounts);

  const scored = reels.map((r) => {
    const hours = Math.max(1, (now() - (r.postedAt || now() - 86400)) / 3600);
    const engagement = r.likes + r.comments * 4 + r.views * 0.05;
    return { ...r, score: engagement / Math.pow(hours, 0.8) };
  }).sort((a, b) => b.score - a.score);

  const stmts = scored.map((r) => env.DB.prepare(
    `INSERT INTO trend_signals (id,source,source_id,url,caption,hashtags,image_url,likes,comments,views,posted_at,score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,source_id) DO UPDATE SET likes=excluded.likes, views=excluded.views, score=excluded.score`
  ).bind(uid(), "instagram", r.id, r.url, r.caption.slice(0, 2000), JSON.stringify(r.hashtags), r.image, r.likes, r.comments, r.views, r.postedAt, r.score));
  if (stmts.length) await env.DB.batch(stmts);

  const top = scored.slice(0, 40);
  if (!top.length) return { reels: 0 };
  const { styles } = await chatJSON<{ styles: { keyword: string; idx: number[] }[] }>(env,
    `You are a jewelry trend analyst. From Instagram reel captions, extract specific, searchable jewelry product styles
     a dropshipper could source on AliExpress (e.g. "chunky gold dome huggie earrings", "freshwater pearl charm necklace").
     Return JSON {"styles":[{"keyword":string,"idx":[reel indexes]}]}. 5-15 styles. Skip non-jewelry.`,
    top.map((r, i) => `[${i}] ${r.caption.slice(0, 300)} ${r.hashtags.join(" ")}`).join("\n"));

  for (const s of styles ?? []) {
    const kw = s.keyword.toLowerCase().trim();
    const boost = (s.idx ?? []).reduce((a, i) => a + (top[i]?.score ?? 0), 0);
    await env.DB.prepare(
      `INSERT INTO trends (id, keyword, momentum, signal_count, last_seen) VALUES (?,?,?,?,?)
       ON CONFLICT(keyword) DO UPDATE SET momentum = momentum*0.7 + excluded.momentum,
         signal_count = signal_count + excluded.signal_count, last_seen = excluded.last_seen`
    ).bind(uid(), kw, boost, s.idx?.length ?? 0, now()).run();
  }
  return { reels: reels.length, styles: styles?.length ?? 0 };
}
