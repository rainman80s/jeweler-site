import type { Env } from "../env";
import { SUPPLIERS } from "../integrations/suppliers";
import { j } from "../lib/util";

/** Called after Stripe confirms payment. Places supplier orders where an API exists; flags the rest for manual. */
export async function fulfillOrder(env: Env, orderId: string) {
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first<any>();
  if (!o) return;
  const items = j<any[]>(o.items, []);
  const ship = j<any>(o.shipping, {});
  const placed: Record<string, string> = {};
  let manual = false;
  for (const it of items) {
    const p = await env.DB.prepare("SELECT supplier, supplier_product_id FROM products WHERE id=?").bind(it.productId).first<any>();
    const sup = p && SUPPLIERS[p.supplier];
    if (!sup?.canAutoOrder || !sup.placeOrder) { manual = true; continue; }
    try {
      const r = await sup.placeOrder(env, { supplierProductId: p.supplier_product_id, quantity: it.qty, shipping: ship });
      placed[it.productId] = r.supplierOrderId;
    } catch (e) { console.error(e); manual = true; }
  }
  await env.DB.prepare("UPDATE orders SET status=?, supplier_order_ids=? WHERE id=?")
    .bind(manual ? "needs_manual" : "fulfilling", JSON.stringify(placed), orderId).run();
}
