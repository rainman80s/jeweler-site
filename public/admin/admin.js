const root = document.getElementById("root");
const money = (c) => "$" + ((c || 0) / 100).toFixed(2);
const esc = (s = "") => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ago = (t) => { const s = Date.now() / 1000 - t; return s < 3600 ? Math.round(s / 60) + "m" : s < 86400 ? Math.round(s / 3600) + "h" : Math.round(s / 86400) + "d"; };
async function api(path, opts = {}) {
  const r = await fetch("/api/admin" + path, { ...opts, headers: { "content-type": "application/json" }, body: opts.body && JSON.stringify(opts.body) });
  if (r.status === 401) { login(); throw new Error("auth"); }
  return r.json();
}
const patch = (p, body) => api(p, { method: "PATCH", body });
async function upload(path, formData) {
  const r = await fetch("/api/admin" + path, { method: "POST", body: formData });
  if (r.status === 401) { login(); throw new Error("auth"); }
  return r.json();
}
function copyBtn(btn, text) { navigator.clipboard.writeText(text); const t = btn.textContent; btn.textContent = "copied ✓"; setTimeout(() => (btn.textContent = t), 1500); }

function login() {
  root.innerHTML = `<form class="login"><h1 style="margin-bottom:18px">GLINT HQ</h1>
    <label>email</label><input name="email" type="email" required><label>password</label><input name="password" type="password" required>
    <p id="err" style="color:var(--red);margin-top:10px"></p><button style="margin-top:14px;width:100%">log in</button></form>`;
  root.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
    r.ok ? shell() : (root.querySelector("#err").textContent = "nope, try again");
  };
}

const SECRET_HOWTO = (name) => `
  <ol>
    <li>Go to <a href="https://dash.cloudflare.com" target="_blank">dash.cloudflare.com</a> → <b>Workers &amp; Pages</b> → <b>jeweler-site</b>.</li>
    <li>Open <b>Settings</b> → <b>Variables and Secrets</b> → <b>+ Add</b>.</li>
    <li>Type: <b>Secret</b>. Variable name: <code>${name}</code> (exactly like that, all caps). Value: paste the key.</li>
    <li>Click <b>Deploy</b>. Come back here and refresh — the badge turns green.</li>
  </ol>
  <p class="note">Only the <b>name</b> goes in the name box. The key itself only goes in the value box — never paste a key into a name, a chat, or an email.</p>`;

const tabs = {
  async setup(m) {
    const s = await api("/setup");
    const badge = (on) => `<span class="pill ${on ? "ok" : "error"}">${on ? "connected" : "not set up"}</span>`;
    m.innerHTML = `<h2>setup</h2>
      <div class="panel"><table>
        <tr><td>Instagram trend scanning (Apify)</td><td>${badge(s.apify)}</td></tr>
        <tr><td>AI listings &amp; images (OpenAI)</td><td>${badge(s.openai)}</td></tr>
        <tr><td>Checkout (Stripe)</td><td>${badge(s.stripe)}</td></tr>
        <tr><td>Order confirmation (Stripe webhook)</td><td>${badge(s.stripe_webhook)}</td></tr>
        <tr><td>Auto-ordering: CJ Dropshipping</td><td>${badge(s.cj)}</td></tr>
        <tr><td>Auto-ordering: AliExpress</td><td>${badge(s.aliexpress)}</td></tr>
      </table></div>

      <div class="panel guide"><h3>1 · OpenAI — writes listings, makes model photos &amp; ads ${badge(s.openai)}</h3>
        <ol>
          <li>Create an account at <a href="https://platform.openai.com/signup" target="_blank">platform.openai.com</a> (this is the developer platform — separate from a ChatGPT subscription).</li>
          <li><b>Add billing:</b> Settings → <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank">Billing</a> → add a card and buy credits ($10–20 is plenty to start).</li>
          <li><b>Set a spending cap:</b> Settings → <a href="https://platform.openai.com/settings/organization/limits" target="_blank">Limits</a> → set a monthly budget (e.g. $50) so the autopilot can never run up a surprise bill.</li>
          <li><b>Verify your organization:</b> Settings → <a href="https://platform.openai.com/settings/organization/general" target="_blank">General</a> → <b>Verify Organization</b>. OpenAI requires this before its image model works — skip it and listings get made without AI photos.</li>
          <li><b>Create the key:</b> <a href="https://platform.openai.com/api-keys" target="_blank">API keys</a> → <b>Create new secret key</b> → name it "glint" → copy it (starts with <code>sk-</code>). You only see it once.</li>
          <li>Add it to the site:</li>
        </ol>
        ${SECRET_HOWTO("OPENAI_API_KEY")}
        <p class="note">Rough cost: ~$0.05–0.25 per AI photo, pennies per listing description.</p>
      </div>

      <div class="panel guide"><h3>2 · Stripe — takes payments ${badge(s.stripe)}</h3>
        <ol>
          <li>Create an account at <a href="https://dashboard.stripe.com/register" target="_blank">dashboard.stripe.com/register</a>.</li>
          <li><b>Activate payments:</b> the dashboard will ask for business details, ID and a bank account for payouts. You can use <b>Test mode</b> (toggle top-right) while that's pending.</li>
          <li><b>Get the secret key:</b> Developers → <a href="https://dashboard.stripe.com/apikeys" target="_blank">API keys</a> → <b>Secret key</b> → Reveal → copy. In test mode it starts with <code>sk_test_</code>, live is <code>sk_live_</code>.</li>
          <li>Add it to the site:</li>
        </ol>
        ${SECRET_HOWTO("STRIPE_SECRET_KEY")}
      </div>

      <div class="panel guide"><h3>3 · Stripe webhook — tells the site an order was paid ${badge(s.stripe_webhook)}</h3>
        <p class="note">Without this, payments go through but orders never get marked paid or sent to the supplier.</p>
        <ol>
          <li>Stripe → Developers → <a href="https://dashboard.stripe.com/webhooks" target="_blank">Webhooks</a> → <b>Add destination</b> (or "Add endpoint").</li>
          <li>Event to send: <code>checkout.session.completed</code>.</li>
          <li>Endpoint URL: <code id="wh">${esc(s.origin)}/api/stripe/webhook</code> <button class="ghost" id="copywh">copy</button></li>
          <li>Save, then on the webhook's page click <b>Reveal</b> under <b>Signing secret</b> and copy it (starts with <code>whsec_</code>).</li>
          <li>Add it to the site:</li>
        </ol>
        ${SECRET_HOWTO("STRIPE_WEBHOOK_SECRET")}
        <p class="note">Test it: in test mode, buy something on the store with card <code>4242 4242 4242 4242</code>, any future date, any CVC. The order should show up as <b>paid</b> in the orders tab.</p>
        <p class="note">Going live later: switch Stripe out of test mode, then replace <code>STRIPE_SECRET_KEY</code> with the <code>sk_live_</code> key and make a new webhook in live mode (it has its own signing secret).</p>
      </div>`;
    m.querySelector("#copywh").onclick = (e) => { navigator.clipboard.writeText(m.querySelector("#wh").textContent); e.target.textContent = "copied ✓"; };
  },
  async dashboard(m) {
    const [d, s] = await Promise.all([api("/overview"), api("/setup")]);
    const k = d.kpi || {};
    const missing = [!s.openai && "OpenAI", !s.stripe && "Stripe", !s.stripe_webhook && "Stripe webhook"].filter(Boolean);
    const f = Object.fromEntries(d.funnel.map((x) => [x.type, x.n]));
    const runBtn = (j, l) => `<button class="ghost" data-job="${j}">▶ ${l}</button>`;
    m.innerHTML = `<h2>dashboard</h2>
      ${missing.length ? `<div class="panel" style="border-color:var(--pink)">⚠️ Not connected yet: <b>${missing.join(", ")}</b>. <a href="#setup" style="color:var(--lime)" onclick="setTimeout(()=>location.reload())">Open setup →</a></div>` : ""}
      <div class="kpis">
        <div class="kpi"><small>revenue · 30d</small><b>${money(k.revenue)}</b></div>
        <div class="kpi"><small>orders · 30d</small><b>${k.orders ?? 0}</b></div>
        <div class="kpi"><small>live products</small><b>${k.active ?? 0}</b></div>
        <div class="kpi"><small>drafts to review</small><b>${k.drafts ?? 0}</b></div>
        <div class="kpi"><small>candidates</small><b>${k.pending ?? 0}</b></div>
        <div class="kpi"><small>manual orders</small><b style="color:${k.manual ? "var(--red)" : ""}">${k.manual ?? 0}</b></div>
      </div>
      <div class="panel"><h3 style="margin-bottom:12px">autopilot</h3><div class="jobs">
        ${runBtn("trends", "scan instagram")}${runBtn("sourcing", "source suppliers")}${runBtn("listing", "build listings")}${runBtn("optimize", "optimize catalog")}${runBtn("marketing", "make ads")}</div></div>
      <div class="panel"><h3 style="margin-bottom:12px">funnel · 30d</h3>
        ${["view", "product_view", "add_to_cart", "checkout", "purchase"].map((t) => `<div style="display:grid;grid-template-columns:120px 1fr 60px;gap:10px;align-items:center;margin:6px 0"><span>${t.replace("_", " ")}</span><div class="bar"><i style="width:${Math.min(100, ((f[t] || 0) / (f.view || 1)) * 100)}%"></i></div><b>${f[t] || 0}</b></div>`).join("")}</div>
      <div class="panel"><h3 style="margin-bottom:8px">top products</h3><table><tr><th></th><th>product</th><th>views</th><th>atc</th><th>sales</th><th>cvr</th></tr>
        ${d.top.map((p) => `<tr><td><img src="${p.images[0] || ""}"></td><td>${esc(p.title)}</td><td>${p.views || 0}</td><td>${p.atc || 0}</td><td>${p.buys || 0}</td><td>${p.views ? ((p.buys / p.views) * 100).toFixed(1) + "%" : "—"}</td></tr>`).join("")}</table></div>
      <div class="panel"><h3 style="margin-bottom:8px">job log</h3><table><tr><th>job</th><th>status</th><th>when</th><th>result</th></tr>
        ${d.jobs.map((j) => `<tr><td>${j.job}</td><td><span class="pill ${j.status}">${j.status}</span></td><td>${ago(j.started_at)} ago</td><td style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)">${esc(j.summary)}</td></tr>`).join("")}</table></div>`;
    m.querySelectorAll("[data-job]").forEach((b) => (b.onclick = async () => { await api("/jobs/" + b.dataset.job, { method: "POST" }); b.textContent = "✓ started"; }));
  },
  async trends(m) {
    const [t, s, runs] = await Promise.all([api("/trends"), api("/signals"), api("/apify-runs")]);
    const max = Math.max(1, ...t.map((x) => x.momentum));
    const live = runs.filter((r) => r.status === "running" || r.status === "processing");
    const what = (r) => (r.meta.kind === "instagram" ? "📸 instagram scan" : `🛒 ${r.meta.supplier} · "${esc(r.meta.keyword)}"`);
    m.innerHTML = `<h2>trends <button data-job>▶ scan now</button></h2>
      <div class="panel"><h3 style="margin-bottom:8px">scrapes ${live.length ? `<span class="pill">${live.length} in progress — this page refreshes itself</span>` : ""}</h3>
        <table><tr><th>what</th><th>status</th><th>started</th><th>result</th></tr>
        ${runs.slice(0, 12).map((r) => `<tr><td>${what(r)}</td><td><span class="pill ${r.status === "done" ? "ok" : r.status === "failed" ? "error" : ""}">${r.status}</span></td>
          <td>${ago(r.started_at)} ago</td><td style="color:var(--muted);max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.items != null ? r.items + " items · " : ""}${esc(r.summary || "")}
          <a href="https://console.apify.com/view/runs/${r.apify_run_id}" target="_blank" style="color:var(--lilac)">apify ↗</a></td></tr>`).join("") || "<tr><td>no scrapes yet — click ▶ scan now</td></tr>"}</table></div>
      <div class="panel"><table><tr><th>style</th><th>momentum</th><th>signals</th><th>status</th><th></th></tr>
      ${t.map((x) => `<tr><td><b>${esc(x.keyword)}</b></td><td style="width:30%"><div class="bar"><i style="width:${(x.momentum / max) * 100}%"></i></div></td><td>${x.signal_count}</td><td><span class="pill">${x.status}</span></td>
        <td>${x.status === "ignored" ? `<button class="ghost" data-t="${x.id}" data-s="new">restore</button>` : `<button class="ghost" data-t="${x.id}" data-s="ignored">ignore</button>`}</td></tr>`).join("")}</table></div>
      <h2>top reels</h2><div class="cgrid">${s.map((r) => `<a class="panel" href="${r.url}" target="_blank"><img src="${r.image_url}" referrerpolicy="no-referrer"><div>❤ ${r.likes} · 💬 ${r.comments} · ▶ ${r.views}</div><small style="color:var(--muted)">${esc(r.caption.slice(0, 120))}</small></a>`).join("")}</div>`;
    m.querySelector("[data-job]").onclick = async (e) => { e.target.textContent = "starting…"; await api("/jobs/trends", { method: "POST" }); setTimeout(() => tabs.trends(m), 2500); };
    if (live.length) setTimeout(() => { if (location.hash === "#trends" && document.body.contains(m)) tabs.trends(m); }, 20000);
    m.querySelectorAll("[data-t]").forEach((b) => (b.onclick = async () => { await patch("/trends/" + b.dataset.t, { status: b.dataset.s }); tabs.trends(m); }));
  },
  async sourcing(m) {
    const c = await api("/candidates?status=pending");
    m.innerHTML = `<h2>supplier candidates <button data-job>▶ source now</button></h2><div class="panel"><table>
      <tr><th></th><th>product</th><th>trend</th><th>supplier</th><th>cost</th><th>orders</th><th>score</th><th></th></tr>
      ${c.map((x) => `<tr><td><img src="${x.images[0] || ""}" referrerpolicy="no-referrer"></td><td><a href="${x.supplier_url}" target="_blank">${esc(x.title.slice(0, 70))}</a></td><td>${esc(x.keyword)}</td><td><span class="pill">${x.supplier}</span></td>
        <td>${money(x.cost_cents + (x.shipping_cents || 0))}</td><td>${x.orders ?? "—"}</td><td>${x.score.toFixed(0)}</td>
        <td style="white-space:nowrap"><button data-c="${x.id}" data-s="approved">approve</button> <button class="ghost" data-c="${x.id}" data-s="rejected">✕</button></td></tr>`).join("") || "<tr><td>no candidates yet — run sourcing</td></tr>"}</table></div>`;
    m.querySelector("[data-job]").onclick = () => api("/jobs/sourcing", { method: "POST" });
    m.querySelectorAll("[data-c]").forEach((b) => (b.onclick = async () => { await patch("/candidates/" + b.dataset.c, { status: b.dataset.s }); b.closest("tr").remove(); }));
  },
  async products(m) {
    const p = await api("/products");
    m.innerHTML = `<h2>products <span><button class="ghost" id="toggleAdd">+ add product</button> <button data-job>▶ build listings from approved</button></span></h2>
      <form class="panel" id="addForm" style="display:none">
        <h3>add a product by hand</h3>
        <p class="note">Fastest way to get products live. Grab the title, price and photos from any supplier page (AliExpress, CJ, Temu…).</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 14px">
          <div><label>title *</label><input name="title" required placeholder="chunky gold dome huggies"></div>
          <div><label>category</label><select name="category"><option value="">auto-detect</option><option>earrings</option><option>necklaces</option><option>rings</option><option>bracelets</option><option>sets</option></select></div>
          <div><label>sell price ($) *</label><input name="price" type="number" step="0.01" required placeholder="24.99"></div>
          <div><label>compare-at / "was" price ($)</label><input name="compare_at" type="number" step="0.01" placeholder="34.99"></div>
          <div><label>your cost incl. shipping ($)</label><input name="cost" type="number" step="0.01" placeholder="6.20"></div>
          <div><label>supplier</label><select name="supplier"><option value="manual">other / manual</option><option>aliexpress</option><option>cj</option><option>temu</option><option>shein</option><option>alibaba</option></select></div>
        </div>
        <label>supplier product link <small>(so you know where to order it)</small></label><input name="supplier_url" placeholder="https://www.aliexpress.com/item/...">
        <label>description <small>(leave empty to auto-write one)</small></label><textarea name="description" rows="3"></textarea>
        <label>photos — upload</label><input name="images" type="file" accept="image/*" multiple>
        <label>…or paste image links <small>(one per line, right-click a supplier photo → copy image address)</small></label><textarea name="image_urls" rows="2"></textarea>
        <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" name="make_prompts" checked style="width:auto"> make ChatGPT image prompts for this product (model shot, flat lay, ad)</label>
        <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" name="status" value="draft" style="width:auto"> save as draft (don't show on the site yet)</label>
        <button style="margin-top:14px">add product</button> <span class="msg"></span>
      </form>
      <div class="panel"><table>
      <tr><th></th><th>title</th><th>category</th><th>price</th><th>cost</th><th>margin</th><th>status</th><th></th></tr>
      ${p.map((x) => `<tr><td><img src="${x.images[0] || ""}"></td><td><a href="/p/${x.slug}" target="_blank">${esc(x.title)}</a>${x.featured ? " ★" : ""}<br><small style="color:var(--muted)">${x.images.length} photo${x.images.length === 1 ? "" : "s"}${x.supplier_url ? ` · <a href="${esc(x.supplier_url)}" target="_blank" style="color:var(--lilac)">supplier ↗</a>` : ""}</small></td>
        <td><select data-cat="${x.id}" style="width:120px">${["earrings", "necklaces", "rings", "bracelets", "sets"].map((c) => `<option ${c === x.category ? "selected" : ""}>${c}</option>`).join("")}</select></td>
        <td><input style="width:90px" value="${(x.price_cents / 100).toFixed(2)}" data-price="${x.id}"></td><td>${money(x.cost_cents)}</td>
        <td>${x.cost_cents ? Math.round((1 - x.cost_cents / x.price_cents) * 100) + "%" : "—"}</td><td><span class="pill ${x.status}">${x.status}</span></td>
        <td style="white-space:nowrap">${x.status !== "active" ? `<button data-p="${x.id}" data-s="active">publish</button>` : `<button class="ghost" data-p="${x.id}" data-s="archived">archive</button>`}
          <button class="ghost" data-prompts="${x.id}" title="make ChatGPT image prompts">🎨 prompts</button>
          <label class="b ghost" style="background:transparent;color:var(--ink);border:1px solid var(--line);cursor:pointer">📷 add photos<input type="file" accept="image/*" multiple data-up="${x.id}" hidden></label></td></tr>`).join("") || `<tr><td>no products yet — click <b>+ add product</b> above, or approve candidates in sourcing.</td></tr>`}</table></div>`;
    const f = m.querySelector("#addForm");
    m.querySelector("#toggleAdd").onclick = () => (f.style.display = f.style.display === "none" ? "block" : "none");
    f.onsubmit = async (e) => {
      e.preventDefault();
      const msg = f.querySelector(".msg"); msg.textContent = "uploading…"; msg.style.color = "var(--muted)";
      const r = await upload("/products", new FormData(f));
      if (r.error) { msg.textContent = r.error; msg.style.color = "var(--red)"; } else tabs.products(m);
    };
    m.querySelector("[data-job]").onclick = () => api("/jobs/listing", { method: "POST" });
    m.querySelectorAll("[data-p]").forEach((b) => (b.onclick = async () => { await patch("/products/" + b.dataset.p, { status: b.dataset.s }); tabs.products(m); }));
    m.querySelectorAll("[data-price]").forEach((i) => (i.onchange = () => patch("/products/" + i.dataset.price, { price_cents: Math.round(+i.value * 100) })));
    m.querySelectorAll("[data-cat]").forEach((i) => (i.onchange = async () => { await patch("/products/" + i.dataset.cat, { category: i.value }); i.style.borderColor = "var(--lime)"; }));
    m.querySelectorAll("[data-prompts]").forEach((b) => (b.onclick = async () => { await api("/image-prompts/product/" + b.dataset.prompts, { method: "POST" }); b.textContent = "✓ see image prompts tab"; }));
    m.querySelectorAll("[data-up]").forEach((i) => (i.onchange = async () => {
      const fd = new FormData(); [...i.files].forEach((file) => fd.append("images", file));
      i.parentElement.firstChild.textContent = "uploading…"; await upload(`/products/${i.dataset.up}/images`, fd); tabs.products(m);
    }));
  },
  async "image prompts"(m) {
    const items = await api("/image-prompts?status=pending");
    const label = { model: "👤 model wearing it", flatlay: "🛋 flat lay", ad: "📣 ad image" };
    m.innerHTML = `<h2>image prompts</h2>
      <div class="panel guide"><b>Make photos with your own ChatGPT account — no API credits.</b>
        <ol><li>Click <b>download reference</b> to save the product photo.</li>
        <li>In ChatGPT, attach that photo, then paste the prompt (<b>copy prompt</b>).</li>
        <li>Download what ChatGPT makes and drop it in <b>upload result</b>. Model shots become the product's main photo, flat lays get added after, ad images land in the marketing tab.</li></ol></div>
      <div class="cgrid">${items.map((x) => `<div class="panel" data-card="${x.id}">
        ${x.ref_image ? `<img src="${x.ref_image}">` : `<p class="note">no product photo yet — add one in products first</p>`}
        <span class="pill">${label[x.kind] || x.kind}</span> <span class="pill ${x.product_status}">${x.product_status}</span>
        <h3 style="margin:8px 0">${esc(x.title)}</h3>
        <textarea rows="6" readonly>${esc(x.prompt)}</textarea>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button data-copy="${x.id}">copy prompt</button>
          ${x.ref_image ? `<a class="b ghost" style="background:transparent;color:var(--ink);border:1px solid var(--line)" href="${x.ref_image}" download>download reference</a>` : ""}
          <label class="b" style="cursor:pointer">upload result<input type="file" accept="image/*" data-upload="${x.id}" hidden></label>
          <button class="ghost" data-skip="${x.id}">skip</button>
        </div></div>`).join("") || `<p class="note">No prompts waiting. They appear automatically when listings are built, or click <b>🎨 prompts</b> on any product.</p>`}</div>`;
    const byId = Object.fromEntries(items.map((x) => [x.id, x]));
    m.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copyBtn(b, byId[b.dataset.copy].prompt)));
    m.querySelectorAll("[data-skip]").forEach((b) => (b.onclick = async () => { await patch("/image-prompts/" + b.dataset.skip, { status: "skipped" }); b.closest("[data-card]").remove(); }));
    m.querySelectorAll("[data-upload]").forEach((i) => (i.onchange = async () => {
      const fd = new FormData(); fd.append("image", i.files[0]);
      i.parentElement.firstChild.textContent = "uploading…";
      const r = await upload(`/image-prompts/${i.dataset.upload}/upload`, fd);
      r.ok ? i.closest("[data-card]").remove() : (i.parentElement.firstChild.textContent = "failed — try again");
    }));
  },
  async orders(m) {
    const o = await api("/orders");
    m.innerHTML = `<h2>orders</h2><div class="panel"><table><tr><th>when</th><th>customer</th><th>items</th><th>total</th><th>status</th><th>tracking</th><th></th></tr>
      ${o.map((x) => { const items = JSON.parse(x.items || "[]"); return `<tr><td>${ago(x.created_at)} ago</td><td>${esc(x.email)}</td><td>${items.map((i) => `${i.qty}× ${esc(i.title)}`).join("<br>")}</td><td>${money(x.total_cents)}</td>
        <td><span class="pill ${x.status}">${x.status}</span></td><td><input style="width:140px" value="${esc(x.tracking || "")}" data-track="${x.id}" placeholder="tracking #"></td>
        <td><button class="ghost" data-f="${x.id}">retry auto-order</button></td></tr>`; }).join("") || "<tr><td>no orders yet</td></tr>"}</table></div>`;
    m.querySelectorAll("[data-track]").forEach((i) => (i.onchange = () => patch("/orders/" + i.dataset.track, { tracking: i.value, status: "shipped" })));
    m.querySelectorAll("[data-f]").forEach((b) => (b.onclick = async () => { await api(`/orders/${b.dataset.f}/fulfill`, { method: "POST" }); tabs.orders(m); }));
  },
  async marketing(m) {
    const c = await api("/creatives");
    m.innerHTML = `<h2>ad creatives <button data-job>▶ generate ads</button></h2><div class="cgrid">
      ${c.map((x) => { const b = JSON.parse(x.body || "{}"); return `<div class="panel">${x.media_key ? `<img src="/img/${x.media_key}">` : ""}<span class="pill">${x.platform}</span>
        <h3 style="margin:8px 0 4px">${esc(b.headline)}</h3><p style="color:var(--muted)">${esc(b.primary_text)}</p><p style="margin-top:8px"><b>hook:</b> ${esc(b.hook)}</p><small>${esc(x.title)}</small></div>`; }).join("") || "<p>no creatives yet</p>"}</div>`;
    m.querySelector("[data-job]").onclick = () => api("/jobs/marketing", { method: "POST" });
  },
  async admins(m) {
    const { me, users } = await api("/users");
    m.innerHTML = `<h2>admins</h2>
      <div class="panel"><table><tr><th>email</th><th>added</th><th></th></tr>
        ${users.map((u) => `<tr><td>${esc(u.email)}${u.id === me ? ' <span class="pill ok">you</span>' : ""}</td><td>${new Date(u.created_at * 1000).toLocaleDateString()}</td>
          <td>${u.id === me ? "" : `<button class="red" data-del="${u.id}" data-em="${esc(u.email)}">remove</button>`}</td></tr>`).join("")}</table></div>
      <form class="panel" id="add"><h3>add an admin</h3>
        <label>email</label><input name="email" type="email" required>
        <label>temporary password <small>(10+ characters — they can change it after logging in)</small></label><input name="password" type="text" minlength="10" required autocomplete="off">
        <button style="margin-top:14px">add admin</button> <span class="msg"></span></form>
      <form class="panel" id="pw"><h3>change my password</h3>
        <label>current password</label><input name="current" type="password" required>
        <label>new password <small>(10+ characters)</small></label><input name="next" type="password" minlength="10" required>
        <button style="margin-top:14px">update password</button> <span class="msg"></span></form>`;
    const send = (sel, path, after) => (m.querySelector(sel).onsubmit = async (e) => {
      e.preventDefault();
      const r = await api(path, { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
      const msg = e.target.querySelector(".msg");
      if (r.error) { msg.style.color = "var(--red)"; msg.textContent = r.error; } else after(e.target, msg);
    });
    send("#add", "/users", () => tabs.admins(m));
    send("#pw", "/users/me/password", (f, msg) => { f.reset(); msg.style.color = "var(--lime)"; msg.textContent = "password updated ✓"; });
    m.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!confirm(`Remove ${b.dataset.em} as an admin?`)) return;
      await api("/users/" + b.dataset.del, { method: "DELETE" }); tabs.admins(m);
    }));
  },
  async settings(m) {
    const s = await api("/settings");
    const field = (k, label, help = "") => `<label>${label} <small>${help}</small></label><textarea rows="2" name="${k}">${esc(JSON.stringify(s[k]))}</textarea>`;
    m.innerHTML = `<h2>settings</h2><form class="panel">
      ${field("hashtags", "instagram hashtags to watch", "JSON array")}${field("accounts", "instagram accounts to watch", 'e.g. ["@brand"]')}
      ${field("suppliers", "enabled suppliers", "cj, aliexpress, alibaba, temu, shein")}${field("min_margin", "minimum margin", "0.6 = 60%")}
      ${field("prune_after_days", "archive non-sellers after N days")}${field("prune_min_views", "…once they have at least N views")}
      ${field("image_mode", "product images", '"manual" = make ChatGPT prompts for you to run · "api" = generate automatically with OpenAI credits')}
      <button style="margin-top:16px">save</button> <span id="ok"></span></form>`;
    m.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      try {
        const body = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, JSON.parse(v)]));
        await api("/settings", { method: "PUT", body }); m.querySelector("#ok").textContent = "saved ✓";
      } catch { m.querySelector("#ok").textContent = "invalid JSON"; }
    };
  },
};

function shell(tab = decodeURIComponent(location.hash.slice(1)) || "dashboard") {
  if (!tabs[tab]) tab = "dashboard";
  root.innerHTML = `<div class="wrap"><aside><div class="logo">GLINT<span>HQ</span></div>
    ${Object.keys(tabs).map((t) => `<a data-tab="${t}" class="${t === tab ? "on" : ""}">${t}</a>`).join("")}
    <a id="logout" style="margin-top:auto">log out</a></aside><main id="m">loading…</main></div>`;
  root.querySelectorAll("[data-tab]").forEach((a) => (a.onclick = () => { location.hash = a.dataset.tab; shell(a.dataset.tab); }));
  root.querySelector("#logout").onclick = async () => { await fetch("/api/auth/logout", { method: "POST" }); login(); };
  tabs[tab](root.querySelector("#m")).catch(() => {});
}
shell();
