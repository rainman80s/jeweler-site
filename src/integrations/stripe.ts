import type { Env } from "../env";

export async function stripe(env: Env, path: string, form: Record<string, string>) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not set");
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const d: any = await r.json();
  if (!r.ok) throw new Error("Stripe: " + JSON.stringify(d.error));
  return d;
}

export async function verifyStripeSig(env: Env, payload: string, header: string | null): Promise<boolean> {
  if (!header || !env.STRIPE_WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts.t}.${payload}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === parts.v1 && Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
}
