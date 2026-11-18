# CLAUDE.md

Jewelry dropshipping store + admin ("HQ") + autopilot, running as a single Cloudflare Worker.
**Read `HANDOFF.md` first** for business context, accounts, current state and roadmap.

## Commands
- `npm run typecheck`: must pass before pushing (CI runs it)
- `npm run dev`: local server (needs `.dev.vars`, copy from `.dev.vars.example`; run `npm run db:init:local` first)
- `npm run db:init` / `db:init:local`: apply `schema.sql` to remote/local D1
- Deploys happen automatically: pushing to `main` or `claude/wonderful-albattani-zfq49z` runs `.github/workflows/deploy.yml` (typecheck → db:init → `scripts/deploy.sh`). Don't ask the user to run terminal commands for deploys.

## Stack
Cloudflare Workers + Hono (TypeScript, `src/`), static SPAs in `public/` (vanilla JS, no build step), D1 (`DB`), R2 (`MEDIA`, served at `/img/<key>`), one hourly cron (`src/agents/scheduler.ts` maps UTC hour → jobs). Bindings/vars in `wrangler.toml`; secrets via Cloudflare (listed in `src/env.ts`).

## Hard rules
- **`schema.sql` runs on every deploy.** Keep it idempotent: `CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`. Never add a bare `ALTER TABLE ... ADD COLUMN` (it fails on the second run). Prefer new tables, or check existence another way.
- **No long work inside a request.** Workers stop `waitUntil` work about 30s after the response. Apify scrapes must use `startActor()` (webhook back to `/api/apify/webhook`) and be processed in `src/agents/apifyRuns.ts`. Don't reintroduce `run-sync` calls.
- **Free plan:** ~50 subrequests per invocation, 5 crons per account (other Workers use some). Keep per-invocation fan-out small; batch D1 writes with `env.DB.batch`.
- **Everything must work without `OPENAI_API_KEY`.** Use the fallbacks in `src/lib/jewelry.ts` (style extraction, title cleaning, template copy, ChatGPT image prompts). OpenAI is an optional upgrade, gated on the key and the `image_mode` setting.
- **Never commit secrets**, and never put keys in `wrangler.toml` `[vars]`. The admin `/setup` endpoint returns booleans only. Keep it that way.
- Admin routes go on the `admin` Hono sub-app (behind `requireAdmin`); `c.get("userId")` is the current admin.
- Store copy never mentions suppliers, China, or dropshipping.
- Brand voice: Gen Z, lowercase-friendly, playful, not cringe. Palette tokens are in `public/styles.css` `:root` (lilac / lime / pink / chrome on near-black ink).

## Where things are
- Routes: `src/index.ts` · pipeline: `src/agents/*` · external APIs: `src/integrations/*`
- Supplier scrapers: actor IDs in `DEFAULT_ACTORS` (`integrations/apify.ts`), input shapes in `INPUTS` + output mapping in `normalizeScraped` (`integrations/suppliers.ts`). Check an actor's input schema before changing it (e.g. the AliExpress actor needs `maxProducts >= 50`).
- Settings are JSON rows in the `settings` table, read with `setting(env, key, default)` and edited in HQ → settings.
- Job results are logged to `job_runs` via `logJob()`; Apify runs are in `apify_runs`. Both are visible in HQ.

## Verifying changes
Typecheck, then run `npm run dev` and hit the endpoints with curl (login: `POST /api/auth/login` with the bootstrap creds from `.dev.vars`, keep the cookie). For admin UI changes, load `/admin/` locally. After pushing, check the GitHub Actions run for the deploy result.
