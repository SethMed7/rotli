#!/usr/bin/env bun
/**
 * Render ONE Markdown note to a readable PDF in the user's Rotli theme.
 *
 * This is the same presentation lane the briefs use (pdf-theme.ts palette →
 * HTML → chrome-pdf.ts), applied to an ordinary note: title, headings, lists,
 * task boxes, quotes, code, tables, links. Rotli calls it for the chat's
 * "create a PDF" artifact (corpus_export_note_pdf), which used to print the
 * note as plain monospace text through cupsfilter with no headings, links, or
 * theme (audit 2026-09-02 §1.4). cupsfilter remains Rotli's fallback when no
 * Chromium-family browser is installed.
 *
 * Usage: bun render-document.ts --in note.md --out note.pdf [--title "Title"]
 * Reads the palette from ROTLI_BREVE_CONFIG (or the vault's routine config);
 * imports only side-effect-free modules so it may run in a vault Breve was
 * never set up in.
 */
import { renderPdf } from "./chrome-pdf";
import { errText } from "./err-text";
import { escapeHtml, inlineHtml } from "./markdown-text";
import { pdfThemeVariables, readPdfTheme, type PdfPalette } from "./pdf-theme";

type Args = { input: string; output: string; title: string };

export function parseArgs(argv: readonly string[]): Args {
  const args: Partial<Args> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--in" && value) args.input = value;
    else if (flag === "--out" && value) args.output = value;
    else if (flag === "--title" && value !== undefined) args.title = value;
    else continue;
    i += 1;
  }
  if (!args.input || !args.output) throw new Error("render-document needs --in <markdown> and --out <pdf>");
  return { input: args.input, output: args.output, title: args.title ?? "" };
}

/** Strip a leading YAML frontmatter block (Rotli notes carry one): the
 * opening fence must be line 1, and the block ends at the next fence line. */
export function stripFrontmatter(markdown: string): string {
  const lines = markdown.split("\n");
  if ((lines[0] ?? "").trimEnd() !== "---") return markdown;
  const close = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  return close === -1 ? markdown : lines.slice(close + 1).join("\n");
}

const TASK = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX/])\]\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+\.\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function taskLi(state: string, text: string): string {
  const box = state === " " ? "☐" : state === "/" ? "◪" : "☑";
  const cls = state === " " ? "" : state === "/" ? ' class="task half"' : ' class="task done"';
  return `<li${cls}><span class="box">${box}</span> ${inlineHtml(text)}</li>`;
}

function tableRow(line: string, tag: "th" | "td"): string {
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => `<${tag}>${inlineHtml(cell.trim())}</${tag}>`);
  return `<tr>${cells.join("")}</tr>`;
}

/** Markdown → HTML body for the print template. Deliberately the same small,
 * deterministic subset the brief renderer understands (plus tasks, quotes,
 * fences, and tables), not a full CommonMark engine — presentation is owned
 * here, and a note that needs more keeps its editable Markdown source. */
export function markdownToHtml(markdown: string, title: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  let fence: string[] | null = null;
  let table: string[] | null = null;
  let firstHeading = true;

  const flushPara = () => {
    if (para.length) out.push(`<p>${inlineHtml(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${inlineHtml(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };
  const flushTable = () => {
    if (table) out.push(`<table>${table.join("")}</table>`);
    table = null;
  };
  const flush = () => {
    flushPara();
    flushList();
    flushQuote();
    flushTable();
  };

  const lines = stripFrontmatter(markdown).replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const line = raw.trimEnd();
    if (fence) {
      if (/^\s*```/.test(line)) {
        out.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else fence.push(raw);
      continue;
    }
    if (/^\s*```/.test(line)) {
      flush();
      fence = [];
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      const text = heading[2] ?? "";
      // the note's own H1 duplicates the masthead title — keep one
      if (firstHeading && level === 1 && text.trim().toLowerCase() === title.trim().toLowerCase()) {
        firstHeading = false;
        continue;
      }
      firstHeading = false;
      out.push(`<h${level}>${inlineHtml(text)}</h${level}>`);
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }
    if (line.trim().startsWith("|")) {
      flushPara();
      flushList();
      flushQuote();
      const next = lines[i + 1] ?? "";
      if (!table) {
        table = [];
        if (TABLE_RULE.test(next)) {
          table.push(`<thead>${tableRow(line, "th")}</thead>`);
          i += 1;
          continue;
        }
      }
      if (TABLE_RULE.test(line)) continue;
      table.push(tableRow(line, "td"));
      continue;
    }
    if (table) flushTable();
    const quoteLine = line.match(/^\s*>\s?(.*)$/);
    if (quoteLine) {
      flushPara();
      flushList();
      quote.push(quoteLine[1] ?? "");
      continue;
    }
    if (quote.length) flushQuote();
    const task = line.match(TASK);
    if (task) {
      flushPara();
      if (!list || list.tag !== "ul") {
        flushList();
        list = { tag: "ul", items: [] };
      }
      list.items.push(taskLi(task[1] ?? " ", task[2] ?? ""));
      continue;
    }
    const bullet = line.match(BULLET);
    if (bullet) {
      flushPara();
      if (!list || list.tag !== "ul") {
        flushList();
        list = { tag: "ul", items: [] };
      }
      list.items.push(`<li>${inlineHtml(bullet[1] ?? "")}</li>`);
      continue;
    }
    const ordered = line.match(ORDERED);
    if (ordered) {
      flushPara();
      if (!list || list.tag !== "ol") {
        flushList();
        list = { tag: "ol", items: [] };
      }
      list.items.push(`<li>${inlineHtml(ordered[1] ?? "")}</li>`);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      // a wrapped list item continues the previous entry
      const last = list.items.pop() ?? "";
      list.items.push(last.replace(/<\/li>$/, ` ${inlineHtml(line.trim())}</li>`));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  if (fence) out.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
  flush();
  return out.join("\n");
}

/** The print stylesheet: Rotli's reading measure and type roles, coloured by
 * the six-token palette every brief already uses. Single column, phone-first,
 * `print-color-adjust: exact` so every theme survives the PDF. */
export function documentCss(palette: PdfPalette): string {
  return `
  :root { ${pdfThemeVariables(palette)} }
  @page { size: Letter; margin: 18mm 17mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { background: var(--bg); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: var(--ink); background: var(--bg);
         font-size: 12pt; line-height: 1.65; }
  .wrap { max-width: 700px; margin: 0 auto; }
  header.doc { border-bottom: 1px solid var(--rule); padding-bottom: 12px; margin-bottom: 22px; }
  header.doc h1 { font-size: 26pt; font-weight: 700; line-height: 1.15; letter-spacing: -0.01em; color: var(--ink); }
  header.doc .meta { margin-top: 6px; font-size: 9.5pt; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-size: 20pt; margin: 26px 0 8px; line-height: 1.2; break-after: avoid; }
  h2 { font-size: 16pt; margin: 24px 0 8px; line-height: 1.25; break-after: avoid; }
  h3 { font-size: 13.5pt; margin: 20px 0 6px; break-after: avoid; }
  h4, h5, h6 { font-size: 12pt; margin: 16px 0 4px; color: var(--muted); break-after: avoid; }
  p { margin: 0 0 11px; }
  ul, ol { margin: 0 0 12px; padding-left: 22px; }
  li { margin: 0 0 5px; break-inside: avoid; }
  li .box { display: inline-block; width: 1.2em; color: var(--accent); }
  li.task.done { color: var(--muted); text-decoration: line-through; }
  li.task.half .box { color: var(--muted); }
  blockquote { margin: 0 0 12px; padding: 8px 14px; border-left: 3px solid var(--accent);
    background: var(--surface); color: var(--muted); }
  blockquote p { margin: 0; }
  a { color: var(--accent); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--accent) 38%, var(--rule)); }
  code { font-family: 'SF Mono', ui-monospace, Menlo, monospace; font-size: 88%;
    background: var(--surface); color: var(--accent); padding: 1px 5px; border-radius: 3px; }
  pre { margin: 0 0 12px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--rule);
    border-radius: 4px; overflow: hidden; white-space: pre-wrap; word-break: break-word; }
  pre code { background: none; color: var(--ink); padding: 0; font-size: 9.5pt; line-height: 1.5; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 14px; font-size: 10.5pt; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  th { font-size: 9.5pt; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  hr { border: 0; border-top: 1px solid var(--rule); margin: 18px 0; }
  em { color: var(--muted); }
  footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid var(--rule);
    font-size: 9pt; color: var(--muted); text-align: center; }`;
}

export function documentHtml(title: string, markdown: string, palette: PdfPalette, dateLabel: string): string {
  const safeTitle = escapeHtml(title || "Untitled");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${safeTitle}</title>
<style>${documentCss(palette)}</style></head>
<body><div class="wrap">
  <header class="doc"><h1>${safeTitle}</h1><div class="meta">${escapeHtml(dateLabel)}</div></header>
  ${markdownToHtml(markdown, title)}
  <footer>${safeTitle} · exported from Rotli · ${escapeHtml(dateLabel)}</footer>
</div></body></html>`;
}

if (import.meta.main) {
  try {
    const { input, output, title } = parseArgs(process.argv.slice(2));
    const markdown = await Bun.file(input).text();
    const palette = readPdfTheme().palette;
    const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const htmlPath = `${output}.html`;
    await Bun.write(htmlPath, documentHtml(title, markdown, palette, date));
    await renderPdf(htmlPath, output);
    console.log(`OK ${output}`);
  } catch (error) {
    console.error(`ERR ${errText(error)}`);
    process.exit(1);
  }
}
