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

const tabs = {
  async dashboard(m) {
    const d = await api("/overview"); const k = d.kpi || {};
    const f = Object.fromEntries(d.funnel.map((x) => [x.type, x.n]));
    const runBtn = (j, l) => `<button class="ghost" data-job="${j}">▶ ${l}</button>`;
    m.innerHTML = `<h2>dashboard</h2>
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
    const [t, s] = await Promise.all([api("/trends"), api("/signals")]);
    const max = Math.max(1, ...t.map((x) => x.momentum));
    m.innerHTML = `<h2>trends <button data-job>▶ scan now</button></h2>
      <div class="panel"><table><tr><th>style</th><th>momentum</th><th>signals</th><th>status</th><th></th></tr>
      ${t.map((x) => `<tr><td><b>${esc(x.keyword)}</b></td><td style="width:30%"><div class="bar"><i style="width:${(x.momentum / max) * 100}%"></i></div></td><td>${x.signal_count}</td><td><span class="pill">${x.status}</span></td>
        <td>${x.status === "ignored" ? `<button class="ghost" data-t="${x.id}" data-s="new">restore</button>` : `<button class="ghost" data-t="${x.id}" data-s="ignored">ignore</button>`}</td></tr>`).join("")}</table></div>
      <h2>top reels</h2><div class="cgrid">${s.map((r) => `<a class="panel" href="${r.url}" target="_blank"><img src="${r.image_url}" referrerpolicy="no-referrer"><div>❤ ${r.likes} · 💬 ${r.comments} · ▶ ${r.views}</div><small style="color:var(--muted)">${esc(r.caption.slice(0, 120))}</small></a>`).join("")}</div>`;
    m.querySelector("[data-job]").onclick = () => api("/jobs/trends", { method: "POST" });
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
    m.innerHTML = `<h2>products <button data-job>▶ build listings from approved</button></h2><div class="panel"><table>
      <tr><th></th><th>title</th><th>price</th><th>cost</th><th>margin</th><th>status</th><th>featured</th><th></th></tr>
      ${p.map((x) => `<tr><td><img src="${x.images[0] || ""}"></td><td><a href="/p/${x.slug}" target="_blank">${esc(x.title)}</a></td>
        <td><input style="width:90px" value="${(x.price_cents / 100).toFixed(2)}" data-price="${x.id}"></td><td>${money(x.cost_cents)}</td>
        <td>${Math.round((1 - x.cost_cents / x.price_cents) * 100)}%</td><td><span class="pill ${x.status}">${x.status}</span></td><td>${x.featured ? "★" : ""}</td>
        <td style="white-space:nowrap">${x.status !== "active" ? `<button data-p="${x.id}" data-s="active">publish</button>` : `<button class="ghost" data-p="${x.id}" data-s="archived">archive</button>`}</td></tr>`).join("")}</table></div>`;
    m.querySelector("[data-job]").onclick = () => api("/jobs/listing", { method: "POST" });
    m.querySelectorAll("[data-p]").forEach((b) => (b.onclick = async () => { await patch("/products/" + b.dataset.p, { status: b.dataset.s }); tabs.products(m); }));
    m.querySelectorAll("[data-price]").forEach((i) => (i.onchange = () => patch("/products/" + i.dataset.price, { price_cents: Math.round(+i.value * 100) })));
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
  async settings(m) {
    const s = await api("/settings");
    const field = (k, label, help = "") => `<label>${label} <small>${help}</small></label><textarea rows="2" name="${k}">${esc(JSON.stringify(s[k]))}</textarea>`;
    m.innerHTML = `<h2>settings</h2><form class="panel">
      ${field("hashtags", "instagram hashtags to watch", "JSON array")}${field("accounts", "instagram accounts to watch", 'e.g. ["@brand"]')}
      ${field("suppliers", "enabled suppliers", "cj, aliexpress, alibaba, temu, shein")}${field("min_margin", "minimum margin", "0.6 = 60%")}
      ${field("prune_after_days", "archive non-sellers after N days")}${field("prune_min_views", "…once they have at least N views")}
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

function shell(tab = location.hash.slice(1) || "dashboard") {
  root.innerHTML = `<div class="wrap"><aside><div class="logo">GLINT<span>HQ</span></div>
    ${Object.keys(tabs).map((t) => `<a data-tab="${t}" class="${t === tab ? "on" : ""}">${t}</a>`).join("")}
    <a id="logout" style="margin-top:auto">log out</a></aside><main id="m">loading…</main></div>`;
  root.querySelectorAll("[data-tab]").forEach((a) => (a.onclick = () => { location.hash = a.dataset.tab; shell(a.dataset.tab); }));
  root.querySelector("#logout").onclick = async () => { await fetch("/api/auth/logout", { method: "POST" }); login(); };
  tabs[tab](root.querySelector("#m")).catch(() => {});
}
shell();
