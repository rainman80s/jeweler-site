import type { Env } from "../env";
import { chatJSON, generateImage } from "../integrations/openai";
import { j, uid } from "../lib/util";

/**
 * Weekly: for featured products, generate ad creatives (image + copy) for IG/TikTok/Pinterest/Meta.
 * Drafts land in `creatives` for review; posting/ads-API pushes are a next step (see README roadmap).
 */
export async function makeCreatives(env: Env, limit = 4) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM products WHERE status='active' ORDER BY featured DESC, created_at DESC LIMIT ?").bind(limit).all<any>();
  let n = 0;
  for (const p of results) {
    const out = await chatJSON<{ ads: { platform: string; headline: string; primary_text: string; hook: string; image_prompt: string }[] }>(env,
      `You are a performance marketer for ${env.STORE_NAME}, a Gen Z jewelry brand. Return JSON {"ads":[...]} with 3 ads
       (platforms: instagram, tiktok, pinterest). Each: headline, primary_text (with emojis sparingly + 3 hashtags), hook (first 2s of a UGC video script), image_prompt.`,
      `Product: ${p.title} — $${(p.price_cents / 100).toFixed(2)}\n${p.description}`);
    for (const ad of out.ads ?? []) {
      let media: string | null = null;
      try {
        const png = await generateImage(env, ad.image_prompt + ". Square ad creative, bold, scroll-stopping, no text.", j<string[]>(p.images, [])[1]?.startsWith("http") ? j<string[]>(p.images, [])[1] : undefined);
        media = `ads/${uid()}.png`;
        await env.MEDIA.put(media, png, { httpMetadata: { contentType: "image/png" } });
      } catch {}
      await env.DB.prepare("INSERT INTO creatives (id,product_id,kind,platform,body,media_key) VALUES (?,?,?,?,?,?)")
        .bind(uid(), p.id, "ad", ad.platform, JSON.stringify(ad), media).run();
      n++;
    }
  }
  return { creatives: n };
}
