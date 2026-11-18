import type { Env } from "../env";

const H = (env: Env) => ({ authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" });

export async function chatJSON<T = any>(env: Env, system: string, user: string): Promise<T> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: H(env),
    body: JSON.stringify({ model: "gpt-4.1-mini", response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error("OpenAI chat " + r.status + " " + (await r.text()));
  const d: any = await r.json();
  return JSON.parse(d.choices[0].message.content);
}

/**
 * Generates an image with OpenAI's image model. When a reference product photo is given,
 * uses the edits endpoint so the real piece is preserved on a generated model ("avatar wearing it").
 * Returns PNG bytes.
 */
export async function generateImage(env: Env, prompt: string, referenceUrl?: string, model = "gpt-image-1"): Promise<ArrayBuffer> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  let r: Response;
  if (referenceUrl) {
    const ref = await fetch(referenceUrl);
    const fd = new FormData();
    fd.append("model", model);
    fd.append("prompt", prompt);
    fd.append("size", "1024x1536");
    fd.append("image[]", new Blob([await ref.arrayBuffer()], { type: ref.headers.get("content-type") ?? "image/jpeg" }), "ref.jpg");
    r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: fd });
  } else {
    r = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: H(env), body: JSON.stringify({ model, prompt, size: "1024x1536" }) });
  }
  if (!r.ok) throw new Error("OpenAI image " + r.status + " " + (await r.text()));
  const d: any = await r.json();
  return Uint8Array.from(atob(d.data[0].b64_json), (c) => c.charCodeAt(0)).buffer;
}
