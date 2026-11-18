import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./env";
import { ensureBootstrapAdmin, hashPassword, requireAdmin, verifyPassword } from "./lib/auth";
import { j, logJob, now, uid } from "./lib/util";
import { stripe, verifyStripeSig } from "./integrations/stripe";
import { fulfillOrder } from "./agents/fulfillment";
import { JOBS, runCron } from "./agents/scheduler";

const app = new Hono<{ Bindings: Env }>();
const hydrate = (p: any) => p && { ...p, images: j(p.images, []), tags: j(p.tags, []) };

// ---------- Media from R2
app.get("/img/*", async (c) => {
  const obj = await c.env.MEDIA.get(c.req.path.slice(5));
  if (!obj) return c.notFound();
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
});

// ---------- Public storefront API
app.get("/api/products", async (c) => {
  const { category, sort = "new", q } = c.req.query();
  let sql = "SELECT id,slug,title,price_cents,compare_at_cents,category,images,featured FROM products WHERE status='active'";
  const args: any[] = [];
  if (category) { sql += " AND category=?"; args.push(category); }
  if (q) { sql += " AND (title LIKE ? OR tags LIKE ?)"; args.push(`%${q}%`, `%${q}%`); }
  sql += sort === "price_asc" ? " ORDER BY price_cents" : sort === "price_desc" ? " ORDER BY price_cents DESC" : sort === "hot" ? " ORDER BY featured DESC, created_at DESC" : " ORDER BY created_at DESC";
  const { results } = await c.env.DB.prepare(sql + " LIMIT 100").bind(...args).all();
  return c.json(results.map(hydrate));
});
app.get("/api/products/:slug", async (c) => {
  const p = await c.env.DB.prepare("SELECT id,slug,title,description,price_cents,compare_at_cents,category,tags,images FROM products WHERE slug=? AND status='active'").bind(c.req.param("slug")).first();
  return p ? c.json(hydrate(p)) : c.notFound();
});

app.post("/api/events", async (c) => {
  const e = await c.req.json<any>().catch(() => ({}));
  const allowed = ["view", "product_view", "add_to_cart", "checkout"];
  if (!allowed.includes(e.type)) return c.json({ ok: false }, 400);
  c.executionCtx.waitUntil(c.env.DB.prepare("INSERT INTO events (type,product_id,session,ref,utm) VALUES (?,?,?,?,?)")
    .bind(e.type, e.productId ?? null, String(e.session ?? "").slice(0, 64), String(e.ref ?? "").slice(0, 200), JSON.stringify(e.utm ?? {})).run());
  return c.json({ ok: true });
});

app.post("/api/checkout", async (c) => {
  const { items } = await c.req.json<{ items: { productId: string; qty: number }[] }>();
  if (!items?.length) return c.json({ error: "empty cart" }, 400);
  const origin = new URL(c.req.url).origin;
  const form: Record<string, string> = {
    mode: "payment", success_url: `${origin}/?order=success`, cancel_url: `${origin}/cart`,
    "shipping_address_collection[allowed_countries][0]": "US", "phone_number_collection[enabled]": "true",
  };
  const clean: any[] = [];
  let i = 0;
  for (const it of items.slice(0, 20)) {
    const p = await c.env.DB.prepare("SELECT id,title,price_cents,images FROM products WHERE id=? AND status='active'").bind(it.productId).first<any>();
    if (!p) continue;
    const qty = Math.max(1, Math.min(10, it.qty | 0));
    clean.push({ productId: p.id, qty, price: p.price_cents, title: p.title });
    form[`line_items[${i}][quantity]`] = String(qty);
    form[`line_items[${i}][price_data][currency]`] = c.env.CURRENCY;
    form[`line_items[${i}][price_data][unit_amount]`] = String(p.price_cents);
    form[`line_items[${i}][price_data][product_data][name]`] = p.title;
    const img = j<string[]>(p.images, [])[0];
    if (img) form[`line_items[${i}][price_data][product_data][images][0]`] = origin + img;
    i++;
  }
  const orderId = uid();
  form["metadata[order_id]"] = orderId;
  const s = await stripe(c.env, "checkout/sessions", form);
  await c.env.DB.prepare("INSERT INTO orders (id,stripe_session_id,items,total_cents) VALUES (?,?,?,?)")
    .bind(orderId, s.id, JSON.stringify(clean), clean.reduce((a, x) => a + x.price * x.qty, 0)).run();
  return c.json({ url: s.url });
});

app.post("/api/stripe/webhook", async (c) => {
  const body = await c.req.text();
  if (!(await verifyStripeSig(c.env, body, c.req.header("stripe-signature") ?? null))) return c.text("bad sig", 400);
  const evt = JSON.parse(body);
  if (evt.type === "checkout.session.completed") {
    const s = evt.data.object;
    const orderId = s.metadata?.order_id;
    const addr = s.shipping_details?.address ?? s.customer_details?.address ?? {};
    const shipping = { name: s.shipping_details?.name ?? s.customer_details?.name, line1: addr.line1, line2: addr.line2, city: addr.city, state: addr.state, postal: addr.postal_code, country: addr.country, phone: s.customer_details?.phone };
    await c.env.DB.prepare("UPDATE orders SET status='paid', email=?, shipping=? WHERE id=?").bind(s.customer_details?.email, JSON.stringify(shipping), orderId).run();
    const o = await c.env.DB.prepare("SELECT items FROM orders WHERE id=?").bind(orderId).first<any>();
    const stmts = j<any[]>(o?.items, []).map((it) => c.env.DB.prepare("INSERT INTO events (type,product_id,value_cents) VALUES ('purchase',?,?)").bind(it.productId, it.price * it.qty));
    if (stmts.length) await c.env.DB.batch(stmts);
    c.executionCtx.waitUntil(fulfillOrder(c.env, orderId));
  }
  return c.json({ received: true });
});

// ---------- Auth
app.post("/api/auth/login", async (c) => {
  await ensureBootstrapAdmin(c.env);
  const { email, password } = await c.req.json<any>();
  const u = await c.env.DB.prepare("SELECT * FROM users WHERE email=?").bind(String(email).toLowerCase()).first<any>();
  if (!u || !(await verifyPassword(password, u.pass_hash))) return c.json({ error: "invalid login" }, 401);
  const sid = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(sid, u.id, now() + 86400 * 14).run();
  setCookie(c, "sid", sid, { httpOnly: true, secure: true, sameSite: "Strict", path: "/", maxAge: 86400 * 14 });
  return c.json({ ok: true, email: u.email });
});
app.post("/api/auth/logout", async (c) => { deleteCookie(c, "sid", { path: "/" }); return c.json({ ok: true }); });

// ---------- Admin API
const admin = new Hono<{ Bindings: Env; Variables: { userId: string } }>();
admin.use("*", requireAdmin);

admin.get("/overview", async (c) => {
  const since = now() - 30 * 86400;
  const [kpi, funnel, top, jobs] = await Promise.all([
    c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM products WHERE status='active') active, (SELECT COUNT(*) FROM products WHERE status='draft') drafts,
      (SELECT COUNT(*) FROM candidates WHERE status='pending') pending, (SELECT COUNT(*) FROM trends) trends,
      (SELECT COUNT(*) FROM orders WHERE status!='pending' AND created_at>?) orders,
      (SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE status!='pending' AND created_at>?) revenue,
      (SELECT COUNT(*) FROM orders WHERE status='needs_manual') manual`).bind(since, since).first(),
    c.env.DB.prepare("SELECT type, COUNT(*) n FROM events WHERE created_at>? GROUP BY type").bind(since).all(),
    c.env.DB.prepare(`SELECT p.id,p.title,p.images, SUM(e.type='product_view') views, SUM(e.type='add_to_cart') atc, SUM(e.type='purchase') buys
      FROM products p LEFT JOIN events e ON e.product_id=p.id AND e.created_at>? WHERE p.status='active' GROUP BY p.id ORDER BY buys DESC, views DESC LIMIT 10`).bind(since).all(),
    c.env.DB.prepare("SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 15").all(),
  ]);
  return c.json({ kpi, funnel: funnel.results, top: top.results.map(hydrate), jobs: jobs.results });
});

// ---------- Admin users
admin.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id,email,created_at FROM users ORDER BY created_at").all<any>();
  return c.json({ me: c.get("userId"), users: results });
});
admin.post("/users", async (c) => {
  const { email, password } = await c.req.json<any>();
  const em = String(email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return c.json({ error: "enter a valid email" }, 400);
  if (String(password ?? "").length < 10) return c.json({ error: "password must be at least 10 characters" }, 400);
  const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE email=?").bind(em).first();
  if (exists) return c.json({ error: "that email is already an admin" }, 400);
  await c.env.DB.prepare("INSERT INTO users (id,email,pass_hash) VALUES (?,?,?)").bind(crypto.randomUUID(), em, await hashPassword(password)).run();
  return c.json({ ok: true });
});
admin.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  if (id === c.get("userId")) return c.json({ error: "you can't remove yourself" }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM users WHERE id=?").bind(id),
  ]);
  return c.json({ ok: true });
});
admin.post("/users/me/password", async (c) => {
  const { current, next } = await c.req.json<any>();
  const u = await c.env.DB.prepare("SELECT pass_hash FROM users WHERE id=?").bind(c.get("userId")).first<any>();
  if (!u || !(await verifyPassword(String(current ?? ""), u.pass_hash))) return c.json({ error: "current password is wrong" }, 400);
  if (String(next ?? "").length < 10) return c.json({ error: "new password must be at least 10 characters" }, 400);
  await c.env.DB.prepare("UPDATE users SET pass_hash=? WHERE id=?").bind(await hashPassword(next), c.get("userId")).run();
  return c.json({ ok: true });
});

// Which integrations are configured (booleans only — never returns values)
admin.get("/setup", (c) => {
  const e = c.env;
  return c.json({
    origin: new URL(c.req.url).origin,
    apify: !!e.APIFY_TOKEN,
    openai: !!e.OPENAI_API_KEY,
    stripe: !!e.STRIPE_SECRET_KEY,
    stripe_webhook: !!e.STRIPE_WEBHOOK_SECRET,
    cj: !!e.CJ_API_KEY,
    aliexpress: !!(e.ALIEXPRESS_APP_KEY && e.ALIEXPRESS_APP_SECRET),
  });
});

admin.get("/trends", async (c) => c.json((await c.env.DB.prepare("SELECT * FROM trends ORDER BY momentum DESC LIMIT 100").all()).results));
admin.get("/signals", async (c) => c.json((await c.env.DB.prepare("SELECT * FROM trend_signals ORDER BY score DESC LIMIT 60").all()).results));
admin.patch("/trends/:id", async (c) => {
  const { status } = await c.req.json<any>();
  await c.env.DB.prepare("UPDATE trends SET status=? WHERE id=?").bind(status, c.req.param("id")).run();
  return c.json({ ok: true });
});

admin.get("/candidates", async (c) => {
  const status = c.req.query("status") ?? "pending";
  const { results } = await c.env.DB.prepare("SELECT c.id,c.supplier,c.supplier_url,c.title,c.cost_cents,c.shipping_cents,c.rating,c.orders,c.images,c.score,c.status,t.keyword FROM candidates c LEFT JOIN trends t ON t.id=c.trend_id WHERE c.status=? ORDER BY score DESC LIMIT 100").bind(status).all();
  return c.json(results.map(hydrate));
});
admin.patch("/candidates/:id", async (c) => {
  const { status } = await c.req.json<any>();
  await c.env.DB.prepare("UPDATE candidates SET status=? WHERE id=?").bind(status, c.req.param("id")).run();
  return c.json({ ok: true });
});

admin.get("/products", async (c) => c.json((await c.env.DB.prepare("SELECT * FROM products ORDER BY created_at DESC LIMIT 300").all()).results.map(hydrate)));
admin.patch("/products/:id", async (c) => {
  const b = await c.req.json<any>();
  const fields = ["title", "description", "price_cents", "compare_at_cents", "category", "status", "featured"].filter((k) => k in b);
  if (!fields.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE products SET ${fields.map((f) => f + "=?").join(",")}, updated_at=? WHERE id=?`)
    .bind(...fields.map((f) => b[f]), now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

admin.get("/orders", async (c) => c.json((await c.env.DB.prepare("SELECT * FROM orders WHERE status!='pending' ORDER BY created_at DESC LIMIT 200").all()).results));
admin.post("/orders/:id/fulfill", async (c) => { await fulfillOrder(c.env, c.req.param("id")); return c.json({ ok: true }); });
admin.patch("/orders/:id", async (c) => {
  const { status, tracking } = await c.req.json<any>();
  await c.env.DB.prepare("UPDATE orders SET status=COALESCE(?,status), tracking=COALESCE(?,tracking) WHERE id=?").bind(status ?? null, tracking ?? null, c.req.param("id")).run();
  return c.json({ ok: true });
});

admin.get("/creatives", async (c) => c.json((await c.env.DB.prepare("SELECT cr.*, p.title FROM creatives cr LEFT JOIN products p ON p.id=cr.product_id ORDER BY cr.created_at DESC LIMIT 100").all()).results));

admin.get("/settings", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM settings").all<any>();
  return c.json(Object.fromEntries(results.map((r) => [r.key, j(r.value, r.value)])));
});
admin.put("/settings", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  await c.env.DB.batch(Object.entries(b).map(([k, v]) => c.env.DB.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, JSON.stringify(v))));
  return c.json({ ok: true });
});

// Run any automation on demand ("Run now" buttons)
admin.post("/jobs/:name", async (c) => {
  const name = c.req.param("name");
  if (!JOBS[name]) return c.json({ error: "unknown job" }, 404);
  c.executionCtx.waitUntil(logJob(c.env, name, () => JOBS[name](c.env)));
  return c.json({ started: name });
});

app.route("/api/admin", admin);

export default {
  fetch: app.fetch,
  scheduled: (evt: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(runCron(evt.scheduledTime, env)),
} satisfies ExportedHandler<Env>;
