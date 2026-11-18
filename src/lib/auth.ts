import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../env";
import { now } from "./util";

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function hashPassword(pw: string, saltHex?: string): Promise<string> {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, key, 256);
  return `${hex(salt.buffer)}:${hex(bits)}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [salt] = stored.split(":");
  return (await hashPassword(pw, salt)) === stored;
}

/** Creates the first admin from secrets if no users exist. */
export async function ensureBootstrapAdmin(env: Env) {
  if (!env.ADMIN_BOOTSTRAP_EMAIL || !env.ADMIN_BOOTSTRAP_PASSWORD) return;
  const c = await env.DB.prepare("SELECT COUNT(*) n FROM users").first<{ n: number }>();
  if (c && c.n > 0) return;
  await env.DB.prepare("INSERT INTO users (id,email,pass_hash) VALUES (?,?,?)")
    .bind(crypto.randomUUID(), env.ADMIN_BOOTSTRAP_EMAIL.toLowerCase(), await hashPassword(env.ADMIN_BOOTSTRAP_PASSWORD)).run();
}

export async function requireAdmin(c: Context<{ Bindings: Env; Variables: { userId: string } }>, next: Next) {
  const sid = getCookie(c, "sid");
  if (!sid) return c.json({ error: "unauthorized" }, 401);
  const s = await c.env.DB.prepare("SELECT user_id FROM sessions WHERE id=? AND expires_at>?").bind(sid, now()).first<{ user_id: string }>();
  if (!s) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", s.user_id);
  await next();
}
