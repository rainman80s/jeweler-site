import type { Env } from "../env";
import { chatJSON, generateImage } from "../integrations/openai";
import { j, retailPrice, slugify, uid } from "../lib/util";

/** Mirrors a remote image into R2 so the storefront never hotlinks suppliers. */
async function mirror(env: Env, url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const key = `p/${uid()}.${(r.headers.get("content-type") ?? "image/jpeg").split("/")[1] ?? "jpg"}`;
    await env.MEDIA.put(key, r.body, { httpMetadata: { contentType: r.headers.get("content-type") ?? "image/jpeg" } });
    return `/img/${key}`;
  } catch { return null; }
}

/** Turns approved candidates into storefront listings: copy, pricing, real photos + AI model shots. */
export async function buildListings(env: Env, limit = 3) {
  const { results } = await env.DB.prepare(
    "SELECT c.*, t.keyword FROM candidates c LEFT JOIN trends t ON t.id=c.trend_id WHERE c.status='approved' ORDER BY score DESC LIMIT ?"
  ).bind(limit).all<any>();

  const made: string[] = [];
  for (const c of results) {
    const copy = await chatJSON<{ title: string; description: string; category: string; tags: string[]; image_prompt: string }>(env,
      `You write product listings for ${env.STORE_NAME}, a Gen Z jewelry brand: playful, confident, lowercase-friendly, no cringe.
       Never mention the supplier, China, or dropshipping. Return JSON {title (<=6 words), description (2 short paragraphs + 3 bullet specs),
       category (one of: earrings, necklaces, rings, bracelets, sets), tags (5), image_prompt (a photoreal editorial shot of a diverse Gen Z model
       wearing THIS exact piece, natural light, phone-camera aesthetic, close crop)}`,
      `Supplier title: ${c.title}\nTrend: ${c.keyword}\nSupplier data: ${String(c.raw).slice(0, 1500)}`);

    const images: string[] = [];
    for (const src of j<string[]>(c.images, []).slice(0, 4)) { const m = await mirror(env, src); if (m) images.push(m); }

    // AI "avatar wearing it" shot, conditioned on the real product photo
    try {
      const ref = j<string[]>(c.images, [])[0];
      const png = await generateImage(env, copy.image_prompt, ref);
      const key = `ai/${uid()}.png`;
      await env.MEDIA.put(key, png, { httpMetadata: { contentType: "image/png" } });
      images.unshift(`/img/${key}`);
    } catch (e) { console.warn("image gen failed", e); }

    const landed = c.cost_cents + (c.shipping_cents ?? 0);
    const price = retailPrice(landed, parseFloat(env.DEFAULT_MARKUP));
    const id = uid();
    await env.DB.prepare(
      `INSERT INTO products (id,slug,title,description,price_cents,compare_at_cents,cost_cents,category,tags,images,candidate_id,supplier,supplier_product_id,supplier_url,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id, slugify(copy.title), copy.title, copy.description, price, Math.round(price * 1.4 / 100) * 100 - 1, landed,
           copy.category, JSON.stringify(copy.tags), JSON.stringify(images), c.id, c.supplier, c.supplier_product_id, c.supplier_url,
           env.AUTO_PUBLISH === "true" ? "active" : "draft").run();
    await env.DB.prepare("UPDATE candidates SET status='listed' WHERE id=?").bind(c.id).run();
    made.push(id);
  }
  return { listed: made.length };
}
