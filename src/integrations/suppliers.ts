import type { Env } from "../env";
import { DEFAULT_ACTORS, runActor } from "./apify";

/** Normalized product from any supplier. */
export interface SupplierProduct {
  supplier: string; id: string; url: string; title: string;
  costCents: number; shippingCents: number; shipDays?: number;
  rating?: number; orders?: number; images: string[]; raw?: unknown;
}

export interface Supplier {
  name: string;
  /** Can we place orders programmatically? If false, orders go to the manual fulfillment queue. */
  canAutoOrder: boolean;
  search(env: Env, query: string, limit?: number): Promise<SupplierProduct[]>;
  placeOrder?(env: Env, order: DropshipOrder): Promise<{ supplierOrderId: string }>;
}

export interface DropshipOrder {
  supplierProductId: string; sku?: string; quantity: number;
  shipping: { name: string; line1: string; line2?: string; city: string; state?: string; postal: string; country: string; phone?: string };
}

const cents = (v: any) => Math.round(parseFloat(String(v ?? "0").replace(/[^0-9.]/g, "")) * 100) || 0;

// ---------- CJ Dropshipping: real dropship API (search + order + tracking). Best for automation.
let cjToken: { t: string; exp: number } | null = null;
async function cjAuth(env: Env) {
  if (cjToken && cjToken.exp > Date.now()) return cjToken.t;
  if (!env.CJ_API_KEY) throw new Error("CJ_API_KEY not set");
  const r = await fetch("https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: env.CJ_API_KEY }),
  });
  const d: any = await r.json();
  cjToken = { t: d.data.accessToken, exp: Date.now() + 1000 * 60 * 60 * 24 * 10 };
  return cjToken.t;
}
const cj: Supplier = {
  name: "cj", canAutoOrder: true,
  async search(env, q, limit = 20) {
    const t = await cjAuth(env);
    const r = await fetch(`https://developers.cjdropshipping.com/api2.0/v1/product/list?productNameEn=${encodeURIComponent(q)}&pageSize=${limit}`, { headers: { "CJ-Access-Token": t } });
    const d: any = await r.json();
    return (d.data?.list ?? []).map((p: any) => ({
      supplier: "cj", id: p.pid, url: `https://cjdropshipping.com/product/-p-${p.pid}.html`, title: p.productNameEn,
      costCents: cents(p.sellPrice), shippingCents: 0, images: [p.productImage].filter(Boolean), raw: p,
    }));
  },
  async placeOrder(env, o) {
    const t = await cjAuth(env);
    const r = await fetch("https://developers.cjdropshipping.com/api2.0/v1/shopping/order/createOrderV2", {
      method: "POST", headers: { "content-type": "application/json", "CJ-Access-Token": t },
      body: JSON.stringify({
        orderNumber: crypto.randomUUID(), shippingCountryCode: o.shipping.country, shippingCustomerName: o.shipping.name,
        shippingAddress: o.shipping.line1, shippingAddress2: o.shipping.line2, shippingCity: o.shipping.city,
        shippingProvince: o.shipping.state, shippingZip: o.shipping.postal, shippingPhone: o.shipping.phone ?? "",
        logisticName: "CJPacket Ordinary", fromCountryCode: "CN",
        products: [{ vid: o.sku ?? o.supplierProductId, quantity: o.quantity }],
      }),
    });
    const d: any = await r.json();
    if (!d.result) throw new Error("CJ order failed: " + JSON.stringify(d));
    return { supplierOrderId: d.data.orderId };
  },
};

// ---------- AliExpress: official Dropshipping API when keys exist, Apify scraper otherwise.
async function aeSign(secret: string, params: Record<string, string>) {
  const base = Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
async function aeCall(env: Env, method: string, biz: Record<string, string>) {
  const p: Record<string, string> = {
    app_key: env.ALIEXPRESS_APP_KEY!, method, sign_method: "sha256", timestamp: String(Date.now()),
    access_token: env.ALIEXPRESS_ACCESS_TOKEN ?? "", ...biz,
  };
  p.sign = await aeSign(env.ALIEXPRESS_APP_SECRET!, p);
  const r = await fetch("https://api-sg.aliexpress.com/sync?" + new URLSearchParams(p));
  return r.json<any>();
}
const aliexpress: Supplier = {
  name: "aliexpress",
  get canAutoOrder() { return true; },
  async search(env, q, limit = 20) {
    if (env.ALIEXPRESS_APP_KEY && env.ALIEXPRESS_APP_SECRET) {
      const d = await aeCall(env, "aliexpress.ds.text.search", { keyWord: q, local: "en_US", countryCode: "US", currency: "USD", pageSize: String(limit) });
      const items = d?.aliexpress_ds_text_search_response?.data?.products?.selection_search_product ?? [];
      return items.map((p: any) => ({
        supplier: "aliexpress", id: String(p.itemId), url: `https://www.aliexpress.com/item/${p.itemId}.html`, title: p.title,
        costCents: cents(p.targetSalePrice ?? p.salePrice), shippingCents: 0, rating: parseFloat(p.score) || undefined,
        orders: parseInt(p.orders) || undefined, images: [p.itemMainPic].filter(Boolean), raw: p,
      }));
    }
    return scrapeVia(env, "aliexpress", DEFAULT_ACTORS.aliexpress, q, limit);
  },
  async placeOrder(env, o) {
    if (!env.ALIEXPRESS_ACCESS_TOKEN) throw new Error("AliExpress OAuth access token required for ordering");
    const d = await aeCall(env, "aliexpress.ds.order.create", {
      param_place_order_request4_open_api_d_t_o: JSON.stringify({
        logistics_address: {
          contact_person: o.shipping.name, address: o.shipping.line1, address2: o.shipping.line2 ?? "", city: o.shipping.city,
          province: o.shipping.state ?? "", zip: o.shipping.postal, country: o.shipping.country, mobile_no: o.shipping.phone ?? "",
        },
        product_items: [{ product_id: o.supplierProductId, sku_attr: o.sku ?? "", product_count: o.quantity }],
      }),
    });
    const id = d?.aliexpress_ds_order_create_response?.result?.order_list?.number?.[0];
    if (!id) throw new Error("AliExpress order failed: " + JSON.stringify(d));
    return { supplierOrderId: String(id) };
  },
};

// ---------- Alibaba / Temu / Shein: no public dropship ordering API -> discovery via Apify, manual fulfillment.
async function scrapeVia(env: Env, supplier: string, actor: string, q: string, limit: number): Promise<SupplierProduct[]> {
  const items = await runActor<any>(env, actor, { search: q, searchTerms: [q], query: q, maxItems: limit, maxProducts: limit });
  return items.slice(0, limit).map((p) => ({
    supplier, id: String(p.id ?? p.productId ?? p.goods_id ?? p.url), url: p.url ?? p.productUrl ?? "",
    title: p.title ?? p.name ?? p.goods_name ?? "", costCents: cents(p.price ?? p.salePrice ?? p.minPrice),
    shippingCents: cents(p.shippingPrice), rating: parseFloat(p.rating ?? p.averageRating) || undefined,
    orders: parseInt(p.orders ?? p.sold ?? p.salesCount) || undefined,
    images: [p.image, p.mainImage, ...(p.images ?? [])].filter((x: any) => typeof x === "string"), raw: p,
  }));
}
const scraped = (name: string, actor: string): Supplier => ({
  name, canAutoOrder: false, search: (env, q, l = 20) => scrapeVia(env, name, actor, q, l),
});

export const SUPPLIERS: Record<string, Supplier> = {
  cj, aliexpress,
  alibaba: scraped("alibaba", DEFAULT_ACTORS.alibaba),
  temu: scraped("temu", DEFAULT_ACTORS.temu),
  shein: scraped("shein", DEFAULT_ACTORS.shein),
};
