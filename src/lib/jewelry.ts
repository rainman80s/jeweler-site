/** Keyword helpers so the autopilot works with no OpenAI key. */
export const MODIFIERS = ["gold", "silver", "pearl", "chunky", "dainty", "minimalist", "dome", "huggie", "charm", "chain", "stacking", "stackable",
  "butterfly", "heart", "star", "moon", "flower", "bow", "y2k", "cross", "initial", "letter", "name", "tennis", "cuban", "rope", "paperclip",
  "beaded", "enamel", "crystal", "rhinestone", "opal", "birthstone", "evil eye", "shell", "drop", "statement", "layered", "twisted", "vintage",
  "chrome", "heart lock", "stacked", "sculptural", "bold", "knotted", "colorful", "pink", "oversized", "chunky gold", "snake", "pave", "cz", "zircon", "freshwater pearl", "18k gold", "rose gold"];
export const NOUNS: Record<string, string> = {
  earrings: "earrings", earring: "earrings", hoops: "earrings", hoop: "earrings", huggies: "earrings", studs: "earrings", "ear cuff": "earrings",
  necklace: "necklaces", necklaces: "necklaces", choker: "necklaces", pendant: "necklaces", chain: "necklaces",
  ring: "rings", rings: "rings", "ring stack": "rings",
  bracelet: "bracelets", bracelets: "bracelets", bangle: "bracelets", cuff: "bracelets", anklet: "bracelets",
  set: "sets",
};

/** Search-friendly product nouns, matched longest-first so "earrings" never also counts as "rings". */
const STYLE_NOUNS: [RegExp, string][] = [
  [/earrings?/, "earrings"], [/huggies?/, "huggies"], [/hoops?/, "hoops"], [/studs?/, "studs"], [/ear ?cuffs?/, "ear cuffs"],
  [/necklaces?/, "necklace"], [/chokers?/, "choker"], [/pendants?/, "pendant"],
  [/bracelets?/, "bracelet"], [/bangles?/, "bangle"], [/anklets?/, "anklet"], [/^rings?$|rings$|^ring(?=stack)/, "rings"],
];

const nounOf = (word: string): string | null => {
  for (const [re, name] of STYLE_NOUNS) if (re.test(word)) return name;
  return null;
};

/**
 * Pulls "modifier + item" styles out of a caption, e.g. "statement earrings", "stacked rings".
 * Captions: a style word paired with the item named within the next 2 words.
 * Hashtags: a single squashed tag containing both ("#goldhoops", "#knottednecklace").
 */
export function extractStyles(text: string): string[] {
  const tokens = text.toLowerCase().replace(/_/g, " ").replace(/[^a-z0-9# ]/g, " ").split(/\s+/).filter(Boolean);
  const single = MODIFIERS.filter((m) => !m.includes(" "));
  const out = new Set<string>();
  const words = tokens.filter((t) => !t.startsWith("#"));
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/s$/, "");
    const mod = single.find((m) => m === words[i] || m === w);
    if (!mod) continue;
    for (const nxt of words.slice(i + 1, i + 3)) {
      const n = nounOf(nxt);
      if (n && !n.startsWith(mod)) { out.add(`${mod} ${n}`); break; }
    }
  }
  for (const tag of tokens.filter((t) => t.startsWith("#")).map((t) => t.slice(1))) {
    const n = nounOf(tag);
    const mod = n && MODIFIERS.find((m) => tag.startsWith(m.replace(/ /g, "")) && !n.startsWith(m));
    if (n && mod) out.add(`${mod} ${n}`);
  }
  return [...out].slice(0, 8);
}

export function categoryOf(title: string): string {
  const t = title.toLowerCase();
  for (const [k, v] of Object.entries(NOUNS)) if (new RegExp(`\\b${k}\\b`).test(t)) return v;
  return "necklaces";
}

const JUNK = /\b(20\d\d|new|hot|sale|fashion|trendy|women'?s?|for women|for girls|ladies|female|jewelry|jewellery|gift|gifts|party|wedding|wholesale|korean|simple|style|accessories|high quality|luxury|elegant|personality|creative|fine|aliexpress|cheap|free shipping|\d+ ?pcs?|\d+pc|1pc|pair)\b/gi;
export function cleanTitle(raw: string): string {
  const words = raw.replace(JUNK, " ").replace(/[^\w\s'-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().split(" ");
  return words.slice(0, 6).join(" ") || "new drop";
}

export function templateCopy(title: string, category: string) {
  const vibe: Record<string, string> = {
    earrings: "the pair that finishes every fit. light enough to wear all day, loud enough to get asked about.",
    necklaces: "layer it, stack it, wear it solo — it's giving main character either way.",
    rings: "made for stacking. wear one, wear five, we're not counting.",
    bracelets: "the arm candy your wrist has been waiting for. stacks perfectly with everything you already own.",
    sets: "the whole look, done for you. split it with your bestie or keep it all.",
  };
  return {
    title,
    description: `${vibe[category] ?? vibe.necklaces}\n\n• hypoallergenic, nickel-free\n• tarnish-resistant finish\n• ships in a gift-ready pouch`,
    category,
    tags: [category, ...title.split(" ").slice(0, 4)],
  };
}

export function imagePrompts(title: string, category: string) {
  const where: Record<string, string> = { earrings: "ears, three-quarter profile, hair tucked back", necklaces: "neck and collarbone", rings: "hands, several fingers visible", bracelets: "wrist and forearm", sets: "neck, ears and hands" };
  const area = where[category] ?? "neck and collarbone";
  return {
    model: `Use the attached product photo as the exact reference — keep the jewelry's shape, color, metal and details identical. Photoreal editorial photo of a Gen Z model wearing this ${title}, close crop on the ${area}. Soft natural window light, warm skin tones, subtle film grain, shot-on-iPhone aesthetic, clean neutral background. Vertical 4:5. No text, no logos, no watermark.`,
    flatlay: `Use the attached product photo as the exact reference — keep the piece identical. Styled flat lay of this ${title} on a soft lilac satin surface with a few small props (a seashell, a hair clip). Top-down, bright diffused light, crisp detail on the metal. Square 1:1. No text.`,
    ad: `Use the attached product photo as the exact reference — keep the piece identical. Scroll-stopping social ad image for a Gen Z jewelry brand: close-up of a model wearing this ${title}, bold lime-green and lilac color blocking in the background, high contrast, glossy, Y2K energy. Square 1:1. Leave empty space at the top for a headline. No text.`,
  };
}
