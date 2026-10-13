import type { Platform } from "./featurePolicy";

export const MERMAID_WEB_REFUSAL =
  "This diagram uses images or links that Rotli Web withholds for privacy. Open it in Rotli for Mac, or remove them to render it here.";

/** Label formatting Mermaid renders as markup and that can't load anything. */
const SAFE_TAGS = "br|b|i|em|strong|u|s|sub|sup|small|mark|code|span|p";

/** Every way a diagram's source can make the page fetch something: an image
 * node or attribute, CSS that loads (url(), @import, theme CSS), a network
 * address, markup beyond plain label formatting, a style attribute, a
 * click/link statement, or an escape that could spell one of these. */
const NETWORK_BEARING = [
  /\bimg\s*[:=]/i,
  /\bsrc\s*[:=]/i,
  /\b(?:xlink:)?href\b/i,
  /\bshape\s*:\s*["']?(?:icon|image)/i,
  /\bicon\s*:/i,
  /url\s*\(/i,
  /image-set\s*\(/i,
  /@import\b/i,
  /\bthemeCSS\b/i,
  /\b(?:https?|ftp|wss?|file):\/\//i,
  /\bdata:/i,
  /(?:^|[\s"'=[(])\/\/[a-z0-9.-]+/im,
  /!\[/,
  new RegExp(`<\\s*\\/?\\s*(?!(?:${SAFE_TAGS})\\b)[a-z!?]`, "i"),
  /<[^>]*\bstyle\s*=/i,
  /^\s*(?:click|links?|callback)\s+[a-z0-9_.:-]+(?:\s|$)/im,
  /^\s*links?\s*:/im,
  /\\(?:x|u|[0-9a-fA-F])/,
];

const NAMED: Record<string, string> = {
  lt: "<",
  gt: ">",
  sol: "/",
  colon: ":",
  lpar: "(",
  bsol: "\\",
  quot: '"',
  amp: "&",
};

/** HTML entities (`&#60;`, `&#x3c;`, `&lt;`) and Mermaid's own (`#60;`,
 * `#lt;`) decoded, so an encoded `<img` or `url(` is caught like a plain one. */
function decodeEntities(code: string): string {
  return code.replace(/(?:&#?|#)(x[0-9a-f]+|\d+|[a-z]+);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (/^x[0-9a-f]+$/.test(lower))
      return String.fromCodePoint(Number.parseInt(lower.slice(1), 16) % 0x110000);
    if (/^\d+$/.test(lower)) return String.fromCodePoint(Number(lower) % 0x110000);
    return NAMED[lower] ?? whole;
  });
}

/** Fail closed before Mermaid sees source: its image loader runs before SVG
 * exists, so sanitizing the output would be too late. Web only — the Mac
 * app's webview can't send note text to a site. */
export function mermaidRefusal(code: string, platform: Platform): string | null {
  if (platform !== "web") return null;
  let decoded = code;
  for (let i = 0; i < 8; i += 1) {
    if (NETWORK_BEARING.some((rule) => rule.test(decoded))) return MERMAID_WEB_REFUSAL;
    const next = decodeEntities(decoded);
    if (next === decoded) return null;
    decoded = next;
  }
  // Entity nesting beyond the bounded decoder is ambiguous to this preflight.
  return MERMAID_WEB_REFUSAL;
}
