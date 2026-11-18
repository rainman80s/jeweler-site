# GLINT — self-running jewelry dropshipping platform

One Cloudflare Worker that is **the storefront, the API, the admin dashboard ("HQ"), and an autopilot** that keeps finding, listing, promoting and pruning products on its own schedule.

```
Instagram reels (Apify) ──► trends ──► supplier search (CJ / AliExpress / Alibaba / Temu / Shein)
                                            │ score: margin × social proof × auto-orderable
                                            ▼
                                       candidates ──(approve: Elias or AUTO_PUBLISH)──► listings
                                                                                     (AI copy, R2 photos,
                                                                                      AI model "wearing it" shot)
storefront analytics ◄── shoppers ◄── storefront ◄─────────────────────────────────────┘
        │                                │ Stripe checkout ──► webhook ──► auto-order at supplier
        ▼                                                                  (or "needs manual" queue)
   optimizer: archive losers, reprice, feature winners, source more of what sells
        ▼
   marketing: weekly ad images + captions + UGC hooks per platform
```

## Stack
- **Cloudflare Workers** (Hono) + **Workers Static Assets** for the site
- **D1** (SQLite) for everything — schema in `schema.sql`
- **R2** for product/AI images, served at `/img/*`
- **One hourly Cron Trigger** runs the autopilot; `src/agents/scheduler.ts` decides which jobs run each hour
- **Apify** for Instagram + marketplace scraping, **OpenAI** for copy and images, **Stripe** for checkout

## Layout
| Path | What |
|---|---|
| `public/` | storefront (home, shop, product page, cart) |
| `public/admin/` | HQ: dashboard, trends, sourcing, products, orders, ads, settings |
| `src/index.ts` | routes: public API, Stripe webhook, auth, admin API, cron entry |
| `src/agents/` | `trends` · `sourcing` · `listing` · `fulfillment` · `optimizer` · `marketing` · `scheduler` |
| `src/integrations/` | `apify` · `suppliers` · `openai` · `stripe` |

## Deploy to Cloudflare
```bash
npm install
npx wrangler login
npx wrangler d1 create jeweler-db        # paste database_id into wrangler.toml
npx wrangler r2 bucket create jeweler-media
npm run db:init
for s in APIFY_TOKEN OPENAI_API_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET CJ_API_KEY ADMIN_BOOTSTRAP_EMAIL ADMIN_BOOTSTRAP_PASSWORD; do npx wrangler secret put $s; done
npm run deploy
```
Then: Stripe → webhook to `https://<site>/api/stripe/webhook` for `checkout.session.completed`. Log in at `/admin` with the bootstrap email/password (the first login creates the account).

Local: `cp .dev.vars.example .dev.vars`, fill it in, `npm run db:init:local`, `npm run dev`.

## Supplier reality check
| Supplier | Find products | Auto-place orders | How |
|---|---|---|---|
| **CJ Dropshipping** | ✅ | ✅ | official API (`CJ_API_KEY`) — best fit for hands-off |
| **AliExpress** | ✅ | ✅ | official Dropshipping API (app key/secret + OAuth token); falls back to Apify scraper |
| Alibaba | ✅ | ❌ | Apify scraper; wholesale/RFQ, orders by hand |
| Temu | ✅ | ❌ | Apify scraper; no seller/dropship API |
| Shein | ✅ | ❌ | Apify scraper; no dropship API |

Orders that can't auto-place land in **HQ → orders** as `needs_manual`. Temu/Shein are best used as *trend & price research*, not fulfillment. Apify actor IDs live in `src/integrations/apify.ts` — check each in the Apify store before relying on it, since community actors change.

## Autopilot controls
- `AUTO_PUBLISH=false` (default): the bot finds, scores and drafts; Elias approves candidates and publishes drafts in HQ.
- `AUTO_PUBLISH=true`: the top candidate per trend is auto-approved and listings go live immediately.
- Every job can be run on demand from HQ and is logged in `job_runs`.

## Roadmap (next pieces)
- Push creatives to Meta/TikTok/Pinterest ads APIs and pull back ROAS into the optimizer
- Order tracking sync (CJ/AliExpress tracking endpoints) + shipping emails (Resend)
- Product variants (sizes/colors) and SKU mapping
- SEO: per-product server-rendered meta tags + sitemap
- Image model: switch `generateImage` model name to the newest OpenAI image model you have access to

## Running without OpenAI
Everything works with no `OPENAI_API_KEY`:
- **Trends**: captions/hashtags are matched against a jewelry style dictionary (`src/lib/jewelry.ts`).
- **Listings**: titles are cleaned from the supplier title; descriptions use on-brand templates.
- **Images**: with `image_mode = "manual"` (default), the system queues ready-to-paste prompts in **HQ → image prompts**. Run them in ChatGPT with the reference photo attached and upload the result — model shots become the lead photo, flat lays are appended, ad images become creatives.
- **Products → + add product** lets you list anything by hand with uploaded photos or pasted image links.

## Automatic deploys
Every push to `main` or the working branch runs `.github/workflows/deploy.yml`: typecheck → update D1 tables (`schema.sql` is idempotent) → `wrangler deploy`.
One-time setup: create a Cloudflare API token (template **Edit Cloudflare Workers**, plus **Account → D1 → Edit**) and save it as the repo secret `CLOUDFLARE_API_TOKEN`.
You can also re-run a deploy from GitHub → Actions → Deploy to Cloudflare → Run workflow.
