# GLINT — Handoff

Everything you need to run, host, and keep building this store, including how to have Claude pick up where we left off.

> **TL;DR**
> - Live site: **https://jeweler-site.eliasbothel.workers.dev** · Admin ("HQ"): **/admin**
> - Code: **github.com/rainman80s/jeweler-site**, branch `claude/wonderful-albattani-zfq49z`
> - Hosting: one Cloudflare Worker + a D1 database + an R2 image bucket
> - Pushing to GitHub deploys automatically (GitHub Actions)
> - To keep building, open this repo in Claude Code and describe what you want. Claude reads `CLAUDE.md` automatically.

---

## 1. What this is

A dropshipping jewelry store with a built-in autopilot:

1. **Finds trends.** It scrapes Instagram Reels for jewelry hashtags and accounts (via Apify), scores them by engagement velocity, and pulls out styles like "statement earrings" or "stacked rings".
2. **Sources products.** It searches AliExpress, CJ Dropshipping, Temu, Shein and Alibaba for those styles, then scores each result on margin, sales, rating, and whether it can be ordered automatically.
3. **Builds listings.** It writes the title, description and price (charm pricing at about 3.2× landed cost), copies supplier photos into R2, and queues ChatGPT image prompts (or generates images with OpenAI if that's connected).
4. **Sells.** Checkout goes through Stripe. A Stripe webhook marks the order paid, and the system auto-orders from CJ or AliExpress where possible. Everything else lands in a "needs manual" queue.
5. **Optimizes.** Every day it archives products that get views but no sales, lowers prices on high-view/low-add-to-cart items, features the winners, and sources more from the trends that sell.
6. **Markets.** Every week it drafts ad copy, video hooks and ad images for featured products.

By default nothing goes live without approval (`AUTO_PUBLISH = "false"` in `wrangler.toml`).

---

## 2. Accounts and ownership

| Thing | Where | Who owns it now | Notes |
|---|---|---|---|
| Code | GitHub `rainman80s/jeweler-site` | original builder (ask them) | Ask to be added as a collaborator (repo Settings → Collaborators) |
| Hosting | Cloudflare account `0e7efdfc…` (in `wrangler.toml`) | Elias | Ask to be invited (dash.cloudflare.com → Manage Account → Members), or move it to your own account (§9) |
| Admin login | `/admin` → **admins** tab | — | The original builder adds you there; change your password on the same tab |
| Apify | console.apify.com | original builder (ask them) | Powers Instagram and marketplace scraping. Pay-per-result, cents per run |
| OpenAI | platform.openai.com | **you, not set up yet** | Optional. Step-by-step in HQ → **setup** |
| Stripe | dashboard.stripe.com | **you, not set up yet** | Needed for checkout. Step-by-step in HQ → **setup** |
| CJ Dropshipping | cjdropshipping.com | not set up | Recommended: the only supplier with a real dropship ordering API that needs no approval process |

Put new keys in **Cloudflare → Workers & Pages → jeweler-site → Settings → Variables and Secrets** (type: Secret). Never paste a key into chat, GitHub, or a file in the repo.

### Secrets the code reads
| Name | Status | What it unlocks |
|---|---|---|
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | set | Creates the first admin on first login (only used while there are no users) |
| `APIFY_TOKEN` | set | Trend scanning and marketplace search |
| `OPENAI_API_KEY` | not set | AI listing copy, AI trend extraction, automatic images (everything works without it) |
| `STRIPE_SECRET_KEY` | not set | Checkout |
| `STRIPE_WEBHOOK_SECRET` | not set | Marks orders paid and triggers fulfillment |
| `CJ_API_KEY` | not set | CJ search and auto-ordering |
| `ALIEXPRESS_APP_KEY` / `_APP_SECRET` / `_ACCESS_TOKEN` | not set | Official AliExpress Dropshipping API (needs an approved developer app). Without it, AliExpress search uses Apify |

The **setup** tab in HQ shows which of these are connected (green or red).

---

## 3. Using the admin (HQ)

| Tab | What it's for |
|---|---|
| **setup** | Connection status, plus OpenAI and Stripe instructions |
| **dashboard** | Revenue, funnel, top products, ▶ run buttons for each automation, job log |
| **trends** | Live scrape status, detected styles with momentum, top reels. Ignore styles you don't want |
| **sourcing** | Supplier products found per trend. **Approve** the ones to list |
| **products** | **+ add product** by hand, publish/archive, edit price, add photos, 🎨 make image prompts |
| **image prompts** | Download the reference photo, copy the prompt into ChatGPT, upload the result. Model shots become the main photo, flat lays get added after, ad images go to marketing |
| **orders** | Paid orders, retry auto-order, add tracking number |
| **marketing** | Ad drafts (headline, caption, hook, image) |
| **admins** | Add or remove admins, change your password |
| **settings** | Hashtags and accounts to watch, enabled suppliers, minimum margin, prune rules, image mode (`"manual"` = ChatGPT prompts, `"api"` = OpenAI) |

**Fastest way to get a store that looks full:** products → **+ add product** 6–10 times with supplier photos, then run the image prompts in ChatGPT.

**Automated flow:** dashboard ▶ scan instagram → wait 1–3 min (trends tab shows progress) → ▶ source suppliers → approve in sourcing → products ▶ build listings → publish the drafts.

---

## 4. Architecture

```
            ┌──────────────── Cloudflare Worker "jeweler-site" ────────────────┐
browser ──► │ static assets (public/)  ─ storefront SPA + /admin SPA            │
            │ Hono API (src/index.ts)  ─ /api/* public, /api/admin/* (cookie)   │
            │ /img/*  ─ serves images from R2                                    │
            │ scheduled() hourly cron ─ src/agents/scheduler.ts picks jobs       │
            └───────┬──────────────┬───────────────┬───────────────┬────────────┘
                    │ D1 (SQLite)  │ R2 (images)   │ Apify ◄─webhook┘ Stripe ◄─webhook
                    ▼              ▼               ▼                 OpenAI (optional)
```

- **Runtime:** Cloudflare Workers, TypeScript, [Hono](https://hono.dev). There's no frontend framework: the storefront and admin are plain JS single-page apps in `public/`.
- **Data:** D1. The full schema is in `schema.sql` and is idempotent (`CREATE TABLE IF NOT EXISTS` / `INSERT OR IGNORE`), so it's re-run on every deploy. **Schema changes must stay idempotent.** To change an existing table, add a new table instead of `ALTER TABLE` (see CLAUDE.md).
- **Images:** R2 bucket `jeweler-media`, served at `/img/<key>`. Folders: `p/` mirrored supplier photos, `u/` manual uploads, `ai/` model shots, `ads/` ad images.
- **Long-running scrapes:** Apify runs are **started** (`startActor`) with a webhook pointing at `/api/apify/webhook?secret=…&run=…`. When a run finishes, that request pulls the dataset and processes it (`src/agents/apifyRuns.ts`). There's a backup poll on the hourly cron and when the trends tab is opened. This is necessary because a Worker request may only keep working about 30s after responding.
- **Auth:** PBKDF2 password hashes, session cookie `sid` (14 days), `requireAdmin` middleware.
- **Analytics:** first-party `events` table (view, product_view, add_to_cart, checkout, purchase), sent by `public/app.js` via `sendBeacon`. The optimizer reads it.

### File map
| Path | Purpose |
|---|---|
| `src/index.ts` | All HTTP routes (public, webhooks, auth, admin) + cron entry |
| `src/agents/scheduler.ts` | Hourly cron → which jobs run each UTC hour |
| `src/agents/trends.ts` | `scanTrends` (start Instagram scrape), `processReels` (score + extract styles) |
| `src/agents/sourcing.ts` | `sourceProducts` (start supplier searches), `saveCandidates` (filter + score) |
| `src/agents/apifyRuns.ts` | Webhook/poll handler that routes finished Apify runs |
| `src/agents/listing.ts` | Candidate → product (copy, price, images, prompts) |
| `src/agents/optimizer.ts` | Daily prune/reprice/feature/expand |
| `src/agents/marketing.ts` | Weekly ad drafts / ad image prompts |
| `src/agents/fulfillment.ts` | Places supplier orders after payment |
| `src/integrations/apify.ts` | Actor IDs, start/poll/dataset, Instagram mapping |
| `src/integrations/suppliers.ts` | CJ API, AliExpress API, scraper input/output normalization |
| `src/integrations/openai.ts` / `stripe.ts` | API clients |
| `src/lib/jewelry.ts` | No-AI fallbacks: style extraction, title cleaning, categories, template copy, image prompt templates |
| `src/lib/util.ts` | ids, settings, retail pricing tiers, job logging |
| `src/lib/auth.ts` | Password hashing, bootstrap admin, admin middleware |
| `public/index.html`, `app.js`, `styles.css` | Storefront |
| `public/admin/index.html`, `admin.js` | HQ |
| `schema.sql` | D1 schema + default settings |
| `wrangler.toml` | Worker config: D1/R2 bindings, cron, vars, account id |
| `.github/workflows/deploy.yml`, `scripts/deploy.sh` | Auto-deploy |

### Database tables
`users`, `sessions` · `trend_signals` (individual reels), `trends` (styles + momentum + status new/sourced/ignored) · `apify_runs` (scrapes in flight) · `candidates` (supplier products: pending/approved/rejected/listed) · `products` (draft/active/archived, `featured`) · `orders` (pending/paid/fulfilling/needs_manual/shipped) · `events` · `creatives` · `image_prompts` (pending/done/skipped) · `job_runs` (log) · `settings` (JSON values).

### Apify actors in use (verified against live data, Nov 2026)
| Purpose | Actor | Input notes |
|---|---|---|
| Instagram hashtags | `apify/instagram-hashtag-scraper` | `{hashtags, resultsType:"reels", resultsLimit}`. Free Apify plan returns only the first page |
| Instagram accounts | `apify/instagram-scraper` | `directUrls` |
| AliExpress | `devcake/aliexpress-products-scraper` | **`maxProducts` minimum is 50**; some items have `priceCurrent: null` (falls back to original price) |
| Alibaba | `devcake/alibaba-products-scraper` | `queries`, `max_pages`. Output mapping not yet seen live |
| Temu | `crw/temu-products-scraper` | `keyword`, `max_items`. Output mapping from schema, not live |
| Shein | `omkar-cloud/shein-scraper` | `queries`, `maxResultsPerSearch`. Output mapping from schema, not live |

Swap actors in `DEFAULT_ACTORS` (apify.ts) and their input shape in `INPUTS` (suppliers.ts). `normalizeScraped` tries many field names.

---

## 5. Deploying

**Automatic:** every push to `main` or `claude/wonderful-albattani-zfq49z` runs GitHub Actions: `npm ci` → typecheck → `npm run db:init` (applies `schema.sql`) → `wrangler deploy`.
- Needs the repo secret **`CLOUDFLARE_API_TOKEN`**: a Cloudflare API token from the "Edit Cloudflare Workers" template plus **Account → D1 → Edit**. Status at the time of handoff: being added. If the first Actions run is red at "Check the Cloudflare key is set", this secret is still missing.
- Watch deploys at github.com/rainman80s/jeweler-site/actions. **Run workflow** redeploys by hand.

**Manual (only if needed):** `npm install`, `npx wrangler login`, `npm run deploy`.

**Local development:** `cp .dev.vars.example .dev.vars` (fill in keys), `npm run db:init:local`, `npm run dev` → http://localhost:8787. Admin login is the bootstrap email/password from `.dev.vars`.

---

## 6. Current state (what's done vs. not)

**Working and tested**
- Storefront: home, shop with filters/sort, product page, cart, Stripe checkout code path
- HQ login, multiple admins, all tabs
- Manual product creation with uploads/image links; ChatGPT image prompt → upload flow
- Instagram scrape mapping and style extraction (tested on real data)
- AliExpress scrape mapping (tested on real data)
- Deploy to Cloudflare; site is live

**Built but not yet proven in production**
- Apify webhook round-trip on the live site (first real "scan now" will prove it)
- Temu / Shein / Alibaba output mapping
- Stripe checkout + webhook (needs Stripe keys)
- CJ / AliExpress auto-ordering (needs keys; AliExpress needs an approved app)
- Optimizer and marketing jobs (need traffic/products to do anything)

**Known issues / limits**
- **Cron:** the Cloudflare free plan allows 5 cron triggers per account, and other Workers on this account were using them. If the hourly schedule isn't saved, deploys pass with a warning and the automations only run from the ▶ buttons. Fix: free a slot, upgrade to Workers Paid ($5/mo), or add an external pinger (e.g. a cron-job.org hit on a secret URL that calls `runCron`).
- **Free plan limits:** about 50 outbound requests per invocation and 10ms CPU. Large sourcing runs or listing builds with many images can hit this. Workers Paid fixes it.
- **Temu and Shein have no ordering API.** Use them for research; fulfill by hand or pick a CJ/AliExpress equivalent.
- **No product variants** (sizes/colors) yet.
- **No customer emails** (order confirmation, shipping) yet. Stripe sends a receipt if enabled in Stripe.
- SEO is minimal: client-rendered pages, no sitemap, no per-product meta tags.
- `GLINT` is a placeholder brand name (`STORE_NAME` in `wrangler.toml`, plus text in `public/index.html`).

---

## 7. Suggested roadmap (in order)

1. **Connect Stripe (test mode) + webhook** and place a test order end to end (card `4242 4242 4242 4242`).
2. **Get a CJ Dropshipping API key**: real auto-fulfillment with no approval process.
3. **Pick a real brand name and domain**, then add the custom domain in Cloudflare (Worker → Settings → Domains & Routes).
4. **Fix the cron** (upgrade, free a slot, or external pinger) so the autopilot runs on its own.
5. **Order emails** via Resend or Postmark: confirmation + tracking.
6. **Tracking sync** from CJ/AliExpress → `orders.tracking` → email the customer.
7. **SEO:** server-render `/p/:slug` meta/OG tags from the Worker, sitemap.xml, product JSON-LD.
8. **Variants** (size/color) mapped to supplier SKUs.
9. **Ads:** push creatives to Meta/TikTok/Pinterest APIs, pull ROAS back into the optimizer.
10. **Reviews/UGC** on product pages; discount codes; email capture → list (the footer form is cosmetic right now).

---

## 8. Continuing with Claude

1. Install Claude Code (claude.com/claude-code). Use the desktop app, or the web at claude.ai/code connected to GitHub.
2. Open the `rainman80s/jeweler-site` repo. Claude reads **`CLAUDE.md`** automatically. That file has the technical rules (idempotent schema, no long work inside requests, how deploys work).
3. Ask for things in plain language, for example:
   - "Read HANDOFF.md, then set up Stripe webhook testing and walk me through a test order."
   - "Add order confirmation emails with Resend. I'll add the API key as a Cloudflare secret."
   - "Add product variants (sizes) mapped to CJ SKUs."
   - "The trends scrape says failed. Here's the message: … Fix it."
   - "Add server-rendered SEO tags for product pages."
4. Claude pushes to GitHub and GitHub deploys. Check the live site after about 2 minutes.
5. When something breaks, paste Claude the exact error from the HQ job log, the trends "scrapes" panel, or the GitHub Actions log.

**Things to tell Claude if it's a fresh session:**
- "Don't put secrets in the repo; I'll add them in Cloudflare."
- "Keep schema.sql idempotent; it runs on every deploy."
- "Anything that calls Apify must use startActor + the webhook, not wait inline."

---

## 9. Moving hosting to your own Cloudflare account

There's a one-time GitHub workflow for this: **Actions → "Move to another Cloudflare account (one-time)" → Run workflow**.
0. In the new account's dashboard: **Compute → Workers & Pages → Account details → Subdomain** to register a workers.dev subdomain, and open **R2 Object Storage** and enable it once (new accounts must; the free tier covers this store). Otherwise image storage can't be created.
1. Add the new account's token as repo secret `NEW_CLOUDFLARE_API_TOKEN` (template **Edit Cloudflare Workers** + **Account → D1 → Edit**).
2. Run the workflow with the new **account ID**. It exports D1 from the old account, creates `jeweler-db` and `jeweler-media` in the new one, imports all rows (admins, products, orders, settings), and copies every referenced image from the old live site. The run summary shows the new `database_id`.
3. Update `wrangler.toml` (`account_id`, `database_id`) and make `deploy.yml` use the new token; push, and it deploys to the new account.
4. Re-add the Worker secrets on the new account (§2). Admin logins carry over because they live in the database.
5. Open the new site's `/admin` once (this records the new address for Apify webhooks), update the Stripe webhook URL, then delete the old Worker so its hourly cron stops.
