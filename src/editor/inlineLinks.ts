// The one Markdown link grammar: `[text](url)` links and bare autolinks —
// `http(s)://…` URLs, `www.…` hosts, plain email addresses, and bare domains
// such as `sethmedina.com` or `github.com/SethMed7/rotli`. A bare domain links
// only when its last label is on BARE_DOMAIN_TLDS, so `node.js`, `file.md`,
// `install.sh`, `v0.95.1`, and `etc.` stay prose: the allowlist leaves out
// every TLD that doubles as a common file extension. The live editor, the
// static renderer, the link click target, the plain-text copy, and read-aloud
// all build their regexes from these sources. Pure — no CodeMirror, no DOM.

import { normalizedWebsite } from "../lib/webUrl";

/** What a link that cannot open says, in the editor and in static readers. */
export const LINK_OPEN_FAILED = "Couldn't open this link";

/** `[text](url)`; the text may be empty (it then shows the url). `[]()` is not
 * a link — there is nothing to show or open — and `![alt](src)` is an image,
 * never a link. Groups: 1 text, 2 url. */
export const MD_LINK_SOURCE = String.raw`(?<!!)\[(?!\]\(\s*\))([^\]]*)\]\(([^)]*)\)`;

// A bare URL keeps trailing punctuation as prose.
const URL_TAIL = String.raw`[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]`;
const HTTP_URL = String.raw`https?:\/\/${URL_TAIL}`;
const WWW_HOST = String.raw`(?<![\w.@/-])www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?:[/?#](?:${URL_TAIL})?)?`;
const EMAIL_BODY = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9_-])`;
const EMAIL = String.raw`(?<![\w.%+\-@/:])${EMAIL_BODY}`;

/** The top-level domains a bare `name.tld` may end on — the single policy.
 * Lowercase only. Deliberately absent because they are everyday file
 * extensions: md, js, ts, txt, py, rs, sh, so, cc, app, json, and friends. */
export const BARE_DOMAIN_TLDS = [
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "io",
  "co",
  "dev",
  "ai",
  "me",
  "xyz",
  "info",
  "biz",
  "us",
  "uk",
  "ca",
  "de",
  "fr",
  "eu",
  "au",
  "nz",
  "jp",
  "gg",
  "tv",
  "fm",
  "ly",
  "to",
  "tech",
  "site",
  "online",
  "blog",
  "page",
  "cloud",
  "shop",
  "store",
  "news",
  "link",
] as const;

// Not glued to a word, path, email, or dotted run on the left; the TLD must end
// the host (`foo.com.zz` and `sethmedina.company` stay prose), so a closing
// sentence period is never part of the link. Emails match first in the
// alternation, so `foo@bar.com` stays one email.
const BARE_DOMAIN = String.raw`(?<![\w.@/:~-])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:${BARE_DOMAIN_TLDS.join("|")})(?![\w-]|\.\w)(?:[/?#](?:${URL_TAIL})?)?`;

/** A bare link typed as plain text. Group-free: the whole match is the link. */
export const AUTOLINK_SOURCE = `(?:${HTTP_URL}|${WWW_HOST}|${EMAIL}|${BARE_DOMAIN})`;

const EMAIL_ONLY = new RegExp(`^${EMAIL_BODY}$`);
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const DOTTED_HOST = /^[a-z\d-]+(?:\.[a-z\d-]+)+$/i;

/** The address a link text or url actually opens, or null when it names
 * nothing openable. A scheme-less web address gains `https://`, a bare email
 * becomes `mailto:`. Relative paths and `#anchors` are not web addresses. The
 * scheme allowlist itself stays in the native opener. */
export function linkHref(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^mailto:/i.test(text)) return EMAIL_ONLY.test(text.slice(7).split("?")[0] ?? "") ? text : null;
  if (EMAIL_ONLY.test(text)) return `mailto:${text}`;
  if (HAS_SCHEME.test(text) && !/^[a-z][a-z\d+.-]*:\/\//i.test(text)) return null;
  const normalized = normalizedWebsite(text);
  if (!normalized) return null;
  if (!HAS_SCHEME.test(text) && !DOTTED_HOST.test(new URL(normalized).hostname)) return null;
  return normalized;
}

/** What an `[text](url)` link displays: its text, or the url when the text is
 * empty. */
export function linkLabel(text: string, url: string): string {
  return text === "" ? url : text;
}

/** The first match of `source` whose span covers column `col`, or null. */
export function linkMatchAt(source: string, lineText: string, col: number): RegExpExecArray | null {
  const re = new RegExp(source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(lineText)) !== null) {
    if (col >= m.index && col <= m.index + m[0].length) return m;
    if (m.index > col) break;
    if (m[0].length === 0) re.lastIndex++;
  }
  return null;
}
