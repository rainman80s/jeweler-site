const $ = (s) => document.querySelector(s);
const app = $("#app");
const money = (c) => "$" + (c / 100).toFixed(2);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
document.getElementById("yr").textContent = new Date().getFullYear();

// ---- analytics (first-party, feeds the optimizer)
const sid = localStorage.getItem("sid") || (localStorage.setItem("sid", crypto.randomUUID()), localStorage.getItem("sid"));
const utm = Object.fromEntries([...new URLSearchParams(location.search)].filter(([k]) => k.startsWith("utm_")));
const track = (type, productId) => navigator.sendBeacon?.("/api/events", new Blob([JSON.stringify({ type, productId, session: sid, ref: document.referrer, utm })], { type: "application/json" }));

// ---- cart
const cart = { get: () => JSON.parse(localStorage.getItem("cart") || "[]"), set(v) { localStorage.setItem("cart", JSON.stringify(v)); badge(); } };
const badge = () => ($("#cart-count").textContent = cart.get().reduce((a, x) => a + x.qty, 0));
function addToCart(p) {
  const c = cart.get(); const ex = c.find((x) => x.productId === p.id);
  ex ? ex.qty++ : c.push({ productId: p.id, qty: 1, title: p.title, price: p.price_cents, image: p.images[0], slug: p.slug });
  cart.set(c); track("add_to_cart", p.id); toast("added to bag ✦");
}
function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.append(d); setTimeout(() => d.remove(), 1800); }

const card = (p, i) => `
  <a class="card" href="/p/${p.slug}" data-link>
    ${p.featured ? '<span class="tag">TRENDING</span>' : p.compare_at_cents ? '<span class="tag">SALE</span>' : ""}
    <div class="ph">${(p.images || []).slice(0, 2).map((s) => `<img src="${s}" alt="${esc(p.title)}" loading="lazy">`).join("")}</div>
    <div class="meta"><h3>${esc(p.title)}</h3><div class="price">${money(p.price_cents)}${p.compare_at_cents ? `<s>${money(p.compare_at_cents)}</s>` : ""}</div></div>
  </a>`;
const api = (u) => fetch(u).then((r) => (r.ok ? r.json() : null));

const routes = {
  async "/"() {
    const hot = (await api("/api/products?sort=hot")) || [];
    app.innerHTML = `
      <section class="hero">
        <div class="hero-copy"><div class="sticker">NEW<br>DROP<br>✦</div>
          <h1>stack it.<br><em>flex</em> it.</h1>
          <p>the jewelry everyone's saving on their feed — found first, priced right, at your door fast.</p>
          <div><a class="btn" href="/shop" data-link>shop the drop →</a></div></div>
        <div class="hero-img">${hot[0] ? `<img src="${hot[0].images[0]}" alt="">` : ""}</div>
      </section>
      <section class="cats">
        <a href="/shop?category=earrings" data-link>earrings</a><a href="/shop?category=necklaces" data-link>necklaces</a>
        <a href="/shop?category=rings" data-link>rings</a><a href="/shop?category=bracelets" data-link>bracelets</a>
      </section>
      <div class="section-head"><h2>trending rn 🔥</h2><a href="/shop" data-link>see all →</a></div>
      <section class="grid">${hot.slice(0, 8).map(card).join("") || "<p>new drops loading… check back soon ✦</p>"}</section>`;
  },
  async "/shop"(q) {
    const cat = q.get("category") || "", sort = q.get("sort") || "new";
    const items = (await api(`/api/products?${new URLSearchParams({ ...(cat && { category: cat }), sort })}`)) || [];
    const cats = ["", "earrings", "necklaces", "rings", "bracelets", "sets"];
    app.innerHTML = `
      <div class="section-head" style="margin-top:32px"><h2>${cat || "shop all"}</h2><span>${items.length} pieces</span></div>
      <div class="filters">${cats.map((c) => `<a href="/shop${c ? "?category=" + c : ""}" data-link class="${c === cat ? "on" : ""}">${c || "all"}</a>`).join("")}
        <select id="sort"><option value="new">newest</option><option value="hot">trending</option><option value="price_asc">price ↑</option><option value="price_desc">price ↓</option></select></div>
      <section class="grid">${items.map(card).join("") || "<p>nothing here yet.</p>"}</section>`;
    $("#sort").value = sort;
    $("#sort").onchange = (e) => { q.set("sort", e.target.value); go("/shop?" + q); };
  },
  async "/p"(q, slug) {
    const p = await api("/api/products/" + encodeURIComponent(slug));
    if (!p) return (app.innerHTML = `<div class="empty"><h2>gone ✦</h2><p>this piece sold out.</p></div>`);
    track("product_view", p.id);
    document.title = `${p.title} — GLINT`;
    app.innerHTML = `
      <section class="pdp">
        <div class="gallery">${p.images.map((s) => `<img src="${s}" alt="${esc(p.title)}">`).join("")}</div>
        <div class="pdp-info">
          <h1>${esc(p.title)}</h1>
          <div class="price">${money(p.price_cents)}${p.compare_at_cents ? `<s>${money(p.compare_at_cents)}</s>` : ""}</div>
          <button class="btn lime" id="add" style="width:100%">add to bag</button>
          <div class="desc">${esc(p.description)}</div>
          <div class="perks"><span>✦ hypoallergenic</span><span>✦ tarnish-resistant</span><span>✦ 30-day returns</span></div>
        </div>
      </section>`;
    $("#add").onclick = () => addToCart(p);
  },
  async "/cart"() {
    const c = cart.get();
    if (!c.length) return (app.innerHTML = `<div class="empty"><h2>your bag is empty</h2><p style="margin:16px 0 24px">let's fix that.</p><a class="btn" href="/shop" data-link>shop now</a></div>`);
    const total = c.reduce((a, x) => a + x.price * x.qty, 0);
    app.innerHTML = `<section class="cart"><h2 style="margin-bottom:20px">your bag</h2>
      ${c.map((x, i) => `<div class="line"><img src="${x.image}" alt=""><div><a href="/p/${x.slug}" data-link><b>${esc(x.title)}</b></a><div class="qty">
        <button data-i="${i}" data-d="-1">−</button> ${x.qty} <button data-i="${i}" data-d="1">+</button></div></div><b>${money(x.price * x.qty)}</b></div>`).join("")}
      <div class="line" style="grid-template-columns:1fr auto;border:0"><span>subtotal</span><b>${money(total)}</b></div>
      <button class="btn" id="checkout" style="width:100%">checkout →</button></section>`;
    app.querySelectorAll(".qty button").forEach((b) => (b.onclick = () => {
      const c = cart.get(); c[b.dataset.i].qty += +b.dataset.d; cart.set(c.filter((x) => x.qty > 0)); routes["/cart"]();
    }));
    $("#checkout").onclick = async (e) => {
      e.target.textContent = "one sec…"; track("checkout");
      const r = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: c.map(({ productId, qty }) => ({ productId, qty })) }) });
      const d = await r.json(); d.url ? (location.href = d.url) : (toast(d.error || "checkout unavailable"), (e.target.textContent = "checkout →"));
    };
  },
};

function render() {
  const [, base, slug] = location.pathname.match(/^(\/[^/]*)\/?(.*)$/) || [];
  const q = new URLSearchParams(location.search);
  if (q.get("order") === "success") { cart.set([]); toast("order placed ✦ check your email"); }
  (routes[base] || routes["/"])(q, decodeURIComponent(slug || ""));
  window.scrollTo(0, 0);
  track("view");
}
function go(u) { history.pushState({}, "", u); render(); }
document.addEventListener("click", (e) => { const a = e.target.closest("a[data-link]"); if (a) { e.preventDefault(); go(a.getAttribute("href")); } });
addEventListener("popstate", render);
badge(); render();
