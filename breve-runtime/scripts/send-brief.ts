#!/usr/bin/env bun
/**
 * Send a BREVE brief via Resend. The EMAIL body is a short, PLAIN-TEXT summary (no theme, just
 * text): the headline + the action-item titles. The full themed newsletter is the attached PDF —
 * that's the thing you read. (Earlier the body was a broken teaser with the wrong action items.)
 * Usage: bun send-brief.ts [YYYY-MM-DD | YYYY-MM-DD-lunch | YYYY-MM-DD-night]  (defaults to latest morning)
 *
 * Resend key lives in Breve's isolated keychain (never in a file); see scripts/secret.ts.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { BREVE as BREVE_DIR, BRIEFS, PDFS } from "./paths";
import { readSecret } from "./secret";
import { claimDelivery } from "./deliveryClaim";

// 1. Resolve which issue to send — from the markdown (the content source).
const dateArg = process.argv[2];
const mornings = readdirSync(BRIEFS).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
const stem = dateArg ?? mornings.at(-1)?.replace(".md", "");
if (!stem) throw new Error(`No .md briefs found in ${BRIEFS}`);
const kind = stem.endsWith("-lunch") ? "lunch" : stem.endsWith("-night") ? "night" : "morning";
const date = stem.slice(0, 10);
const issueNo = String(Math.max(0, mornings.indexOf(`${date}.md`)) + 1).padStart(3, "0");
const md = await Bun.file(join(BRIEFS, `${stem}.md`)).text().catch(() => null);
if (!md) { console.error(`ERR no brief markdown at ${join(BRIEFS, `${stem}.md`)}`); process.exit(1); }

// 2. Resend key from the isolated keychain.
let apiKey: string;
try { apiKey = await readSecret("resend-breve"); if (!apiKey) throw new Error("empty"); }
catch { console.error("No Resend key in Breve's keychain. Migrate it with:\n  bash scripts/keychain-migrate.sh"); process.exit(1); }
const config = await Bun.file(join(BREVE_DIR, "recipients.json")).json();

// 3. Build a short PLAIN-TEXT summary (no HTML, no theme): headline + action-item titles.
const stripMd = (s: string) =>
  s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/[*_]/g, "").replace(/\s+/g, " ").trim();

const niceDate = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const label = kind === "morning" ? `Issue Nº ${issueNo}` : kind === "lunch" ? "Lunch Pivot" : "Nightcap";

// Section helpers — the markdown is shape-aware per meal (morning/lunch/night use different headers).
// sectionBody: the raw lines under a "## …" header, up to the next ##/---/EOF.
const sectionBody = (src: string, header: RegExp) =>
  src.match(new RegExp(`(?:^|\\n)##\\s*${header.source}[^\\n]*\\n+([\\s\\S]*?)(?:\\n##\\s|\\n---|\\s*$)`, "i"))?.[1] ?? "";
// firstMeaningfulLines: the first n non-empty lines of a block, keeping bullets (don't drop -/* lines).
const firstMeaningfulLines = (block: string, n: number) =>
  block.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, n);
// Which "## …" section headings are actually present (for the lunch/night "Inside:" list).
const headingsPresent = (src: string, names: string[]) =>
  names.filter((name) => new RegExp(`^##\\s*${name}\\b`, "im").test(src));

let headline = "";          // morning lede / lunch+night summary — drives the subject too
let items: string[] = [];   // morning action-item titles, or lunch/night section list
let itemsLabel = "Action items";

if (kind === "lunch") {
  const summary = sectionBody(md, /Delta Check/) || sectionBody(md, /Macro Scout/);
  headline = firstMeaningfulLines(summary, 2).map(stripMd).join(" ");
  items = headingsPresent(md, ["Delta Check", "Macro Scout", "Tooling Tease", "Rabbit Hole Hooks"]);
  itemsLabel = "Inside";
} else if (kind === "night") {
  const summary = sectionBody(md, /Since Lunch/) || sectionBody(md, /Rabbit Holes, Dug/);
  headline = firstMeaningfulLines(summary, 2).map(stripMd).join(" ");
  items = headingsPresent(md, ["Since Lunch", "Rabbit Holes, Dug", "Tomorrow Setup", "Long-form Pick"]);
  itemsLabel = "Inside";
} else {
  // morning: "## Headline" is the required shape — fall back to the first real paragraph only if absent.
  let headlineBlock = sectionBody(md, /Headline/);
  if (!headlineBlock) {
    console.error("morning brief missing ## Headline — using first paragraph");
    headlineBlock = md.split("\n").find((l) => l.trim() && !/^[#>*\-]/.test(l.trim())) ?? "";
  }
  headline = stripMd(headlineBlock);
  // Action items = the bullet titles under the "Action Items" section (the real alerts, not story heads).
  const actionsBlock = sectionBody(md, /[^\n]*Action Items/);
  items = [...actionsBlock.matchAll(/^[-*]\s+(.+)$/gm)]
    .map((m) => stripMd(m[1].match(/\*\*(.+?)\*\*/)?.[1] ?? m[1].split(/[.:]/)[0]).replace(/[:.]$/, ""))
    .filter(Boolean);
}

const hasPdf = await Bun.file(join(PDFS, `${stem}.pdf`)).exists();
const tail = `${hasPdf ? "Full brief attached as PDF." : "Full brief: see Signal."} Audio is in your Signal.`;
const text = [
  `BREVE · ${label} · ${niceDate}`,
  "",
  headline,
  ...(items.length ? ["", `— ${itemsLabel} —`, ...items.map((a) => `• ${a}`)] : []),
  "",
  tail,
].filter((l) => l !== undefined).join("\n");

const emoji = kind === "morning" ? "☕" : kind === "lunch" ? "🥪" : "🌙";
const shortHead = headline.length > 72 ? headline.slice(0, 72).replace(/\s+\S*$/, "") + "…" : headline;
const subject = kind === "morning" ? `${emoji} BREVE #${Number(issueNo)} · ${shortHead || date}` : `${emoji} BREVE ${label} · ${date}`;

// Dry run: preview the plain-text body without sending (BREVE_DRYRUN=1).
if (process.env.BREVE_DRYRUN === "1") {
  console.log(`DRY subject: ${subject}\n--- body ---\n${text}\n--- end (pdf: ${hasPdf}) ---`);
  process.exit(0);
}

const dedupeCompleted = process.env.ROTLI_SCHEDULED === "1" && !process.env.BREVE_REGEN;
const delivery = await claimDelivery(BREVE_DIR, `${stem}.email`, { force: !dedupeCompleted });
if (delivery.status === "delivered") {
  console.log(`OK ${stem} email delivery already recorded`);
  process.exit(0);
}
if (delivery.status === "busy") {
  console.error(`ERR ${stem} email delivery is already in progress`);
  process.exit(75);
}
process.on("exit", () => {
  if (delivery.status === "claimed") delivery.release();
});

// 4. Send: plain-text body + the full newsletter PDF attached.
const pdf = Bun.file(join(PDFS, `${stem}.pdf`));
const attachments = hasPdf
  ? [{ filename: `BREVE-${stem}.pdf`, content: Buffer.from(await pdf.arrayBuffer()).toString("base64") }]
  : [];
const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ from: config.from, to: config.to, subject, text, attachments }),
});
const body = await res.json();
if (!res.ok) { console.error(`Resend error ${res.status}:`, body); process.exit(1); }
if (delivery.status === "claimed") await delivery.complete(String(body.id ?? ""));
console.log(`Sent ${kind} (${stem}) to ${config.to.join(", ")} — id ${body.id} (${attachments.length ? "pdf attached" : "no pdf"})`);
