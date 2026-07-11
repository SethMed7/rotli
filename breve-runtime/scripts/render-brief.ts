#!/usr/bin/env bun
/**
 * Render a brief's markdown into a READABLE blog/newsletter HTML + PDF. Breve owns presentation;
 * the brief skill only writes briefs/<stem>.md. Light, airy, generous type — built to actually read,
 * like a blog post, not a dense dark broadsheet. No "Issue Nº". Sources stay clickable.
 * Writes briefs/<stem>.html and renders your storage's brevePDFs/<stem>.pdf via headless Chrome.
 * Usage: bun render-brief.ts [YYYY-MM-DD | YYYY-MM-DD-lunch | YYYY-MM-DD-night]  (defaults to latest morning)
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { BRIEFS, PDFS } from "./paths";
import { pdfThemeVariables, readPdfTheme } from "./pdf-theme";

const stem = process.argv[2]
  ?? readdirSync(BRIEFS).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().at(-1)?.replace(".md", "");
if (!stem) { console.error("ERR no brief markdown found"); process.exit(1); }
const md = await Bun.file(join(BRIEFS, `${stem}.md`)).text().catch(() => null);
if (!md) { console.error(`ERR no markdown at briefs/${stem}.md`); process.exit(1); }

const kind = stem.endsWith("-lunch") ? "lunch" : stem.endsWith("-night") ? "night" : "morning";
const date = stem.slice(0, 10);
const d = new Date(date + "T12:00:00");
const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
const longDate = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const slot = kind === "morning" ? "Morning" : kind === "lunch" ? "Midday" : "Evening";
const pdfTheme = readPdfTheme();

// ── Markdown → readable HTML ─────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}
function mdToBody(src: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  let listTag: "ul" | "ol" = "ul";
  let section = "";                       // current ## section name (lowercased)
  const flushPara = () => {
    if (!para.length) return;
    const html = inline(para.join(" "));
    out.push(section === "headline" ? `<p class="lede">${html}</p>` : `<p>${html}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const cls = section.includes("action") ? ' class="actions"' : "";
    out.push(`<${listTag}${cls}>${list.join("")}</${listTag}>`);
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };
  for (const raw of src.split("\n")) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) { flush(); continue; }
    if (/^#\s+/.test(line)) { flush(); continue; }                  // skip md H1 — masthead instead
    if (/^---+$/.test(line)) { flush(); continue; }
    if ((m = line.match(/^##\s+(.+)/))) {
      flush(); section = m[1].toLowerCase();
      if (section !== "headline") out.push(`<h2>${inline(m[1])}</h2>`); // "Headline" becomes a bare lede
      continue;
    }
    if ((m = line.match(/^###\s+(.+)/))) { flush(); out.push(`<h3>${inline(m[1])}</h3>`); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.+)/))) { flushPara(); if (!list || listTag !== "ul") { flushList(); list = []; listTag = "ul"; } list.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = line.match(/^\s*\d+\.\s+(.+)/))) { flushPara(); if (!list || listTag !== "ol") { flushList(); list = []; listTag = "ol"; } list.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = line.match(/^\*([^*].*[^*])\*$/))) { flush(); out.push(`<p class="meta">${inline(m[1])}</p>`); continue; } // date · sources / lens
    para.push(line);
  }
  flush();
  return out.join("\n");
}

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>BREVE — ${weekday}, ${longDate}</title>
<style>
  :root { ${pdfThemeVariables(pdfTheme.palette)} }
  @page { size: Letter; margin: 18mm 17mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { background: var(--bg); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Georgia, 'Times New Roman', serif; color: var(--ink); background: var(--bg);
         font-size: 12.5pt; line-height: 1.7; }
  .wrap { max-width: 700px; margin: 0 auto; }
  .sans { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }
  /* Masthead — no issue number, just the wordmark + the day */
  .masthead { text-align: center; border-bottom: 3px double var(--ink); padding-bottom: 14px; margin-bottom: 26px; }
  .masthead .kicker { font-family: -apple-system, 'Helvetica Neue', sans-serif; font-size: 8.5pt;
    letter-spacing: 0.32em; text-transform: uppercase; color: var(--accent); }
  .masthead h1 { font-size: 42pt; font-weight: 700; letter-spacing: 0.14em; line-height: 1; margin: 6px 0 4px; color: var(--ink); }
  .masthead .dateline { font-family: -apple-system, 'Helvetica Neue', sans-serif; font-size: 9.5pt;
    letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  /* Lede / standfirst */
  p.lede { font-size: 15.5pt; line-height: 1.55; color: var(--ink); margin: 0 0 22px;
    background: var(--surface); padding: 14px 16px; border: 1px solid var(--rule); }
  /* Sections */
  h2 { font-family: -apple-system, 'Helvetica Neue', sans-serif; font-size: 11pt; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--accent); border-bottom: 1px solid var(--rule);
    padding-bottom: 6px; margin: 34px 0 14px; break-after: avoid; }
  h3 { font-size: 15pt; font-weight: 700; color: var(--ink); line-height: 1.35; margin: 20px 0 3px; break-after: avoid; }
  p { margin: 0 0 13px; }
  p.meta { font-family: -apple-system, 'Helvetica Neue', sans-serif; font-size: 9.5pt; color: var(--muted);
    margin: 0 0 9px; line-height: 1.5; }
  em { color: var(--muted); }                       /* lens lines render italic + muted */
  ul, ol { margin: 0 0 14px; padding-left: 24px; }
  li { margin: 0 0 9px; break-inside: avoid; }
  /* Action items — the brand's alert box */
  ul.actions { list-style: none; padding: 14px 18px; margin: 0 0 16px;
    background: color-mix(in srgb, var(--accent) 10%, var(--bg));
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--rule)); border-radius: 3px; }
  ul.actions li { padding: 5px 0; border-bottom: 1px solid color-mix(in srgb, var(--accent) 24%, var(--rule)); margin: 0; }
  ul.actions li:last-child { border-bottom: none; }
  a { color: var(--accent); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--accent) 38%, var(--rule)); }
  code { font-family: 'SF Mono', ui-monospace, Menlo, monospace; font-size: 88%;
    background: var(--surface); color: var(--accent); padding: 1px 5px; border-radius: 3px; }
  footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid var(--rule);
    font-family: -apple-system, 'Helvetica Neue', sans-serif; font-size: 9pt; color: var(--muted); text-align: center; }
</style></head>
<body><div class="wrap">
  <div class="masthead">
    <div class="kicker">Your Personal Wire</div>
    <h1>BREVE</h1>
    <div class="dateline">${weekday} · ${slot} · ${longDate}</div>
  </div>
  ${mdToBody(md)}
  <footer>BREVE · ${weekday}, ${longDate} · sources linked throughout</footer>
</div></body></html>`;

await Bun.write(join(BRIEFS, `${stem}.html`), html);

// ── Render to PDF via headless Chrome ────────────────────────────────────────
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pdfPath = join(PDFS, `${stem}.pdf`);
const p = Bun.spawn([chrome, "--headless", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
  `--print-to-pdf=${pdfPath}`, `file://${join(BRIEFS, `${stem}.html`)}`], { stdout: "ignore", stderr: "pipe" });
const err = await new Response(p.stderr).text();
if ((await p.exited) !== 0 || !(await Bun.file(pdfPath).exists())) {
  console.error(`ERR Chrome PDF render failed: ${err.slice(0, 300)}`); process.exit(1);
}
console.log(`OK ${pdfPath} (${(Bun.file(pdfPath).size / 1024).toFixed(0)} KB) + briefs/${stem}.html`);
