import type { Env } from "../env";
export const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
export const now = () => Math.floor(Date.now() / 1000);
export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) + "-" + uid().slice(0, 4);
export const j = <T = any>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export async function setting<T>(env: Env, key: string, d: T): Promise<T> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first<{ value: string }>();
  return r ? j(r.value, d) : d;
}

/** Round to a "charm" price: 19.99, 24.99, 29.99 ... */
export function retailPrice(costCents: number, markup: number): number {
  const raw = (costCents * markup) / 100;
  const tiers = [9.99, 12.99, 14.99, 17.99, 19.99, 22.99, 24.99, 29.99, 34.99, 39.99, 44.99, 49.99, 59.99, 69.99, 79.99];
  const t = tiers.find((p) => p >= raw) ?? Math.ceil(raw) - 0.01;
  return Math.round(t * 100);
}

export async function logJob<T>(env: Env, job: string, fn: () => Promise<T>): Promise<T | undefined> {
  const id = uid();
  await env.DB.prepare("INSERT INTO job_runs (id, job, status) VALUES (?,?, 'running')").bind(id, job).run();
  try {
    const out = await fn();
    await env.DB.prepare("UPDATE job_runs SET status='ok', summary=?, finished_at=? WHERE id=?")
      .bind(JSON.stringify(out ?? {}).slice(0, 4000), now(), id).run();
    return out;
  } catch (e: any) {
    await env.DB.prepare("UPDATE job_runs SET status='error', summary=?, finished_at=? WHERE id=?")
      .bind(String(e?.stack ?? e).slice(0, 4000), now(), id).run();
    console.error(job, e);
  }
}
