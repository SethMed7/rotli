#!/usr/bin/env bun
/**
 * Research a topic and email it. Used by the Signal daemon's casual "email me about X".
 * Usage: bun email-topic.ts <pdf|plain> <recipient> <topic...>
 * Prints "OK <id>" on success, "ERR <reason>" on failure.
 */
import { join } from "node:path";
import { renderPdf } from "./chrome-pdf";
import { errText } from "./err-text";
import { TOPICS, PDFS } from "./paths";
import { readSecret } from "./secret";
import { runModel, STRICT_MCP, CLAUDE_BIN } from "./run-model";
import { pdfThemeVariables, readPdfTheme } from "./pdf-theme";
import { effectiveTz, loadSettings, todayIn } from "./timectx";
import type { ResendResponse } from "./wire-types";

const [format, recipient, ...topicParts] = process.argv.slice(2);
const topic = topicParts.join(" ").trim();
if (!format || !recipient || !topic) { console.log("ERR usage"); process.exit(1); }

const BREVE = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");
const config = await Bun.file(join(BREVE, "recipients.json")).json();
const pdfTheme = readPdfTheme();
const palette = pdfTheme.palette;
let apiKey: string;
try { apiKey = await readSecret("resend-breve"); if (!apiKey) throw new Error("empty"); }
catch { console.log("ERR no Resend key in Keychain"); process.exit(1); }

// 1. Research + draft the body via Claude (Sonnet, web access).
const prompt = `Research this topic using current web info and write a concise briefing email body about it: "${topic}".
Output ONLY an HTML fragment (no <html>/<head>/<body>, no markdown fences): one <h2> title, then <p>/<ul> content (200-450 words), ending with a <p> of 1-3 source links as <a href>. Sharp and factual, written for the owner (a technical reader). No preamble, no sign-off.`;
const proc = runModel([CLAUDE_BIN, "-p", "--model", "sonnet", "--dangerously-skip-permissions", ...STRICT_MCP], {
  cwd: process.env.HOME, stdin: "pipe", stdout: "pipe", stderr: "pipe",
});
await proc.stdin.write(prompt);
await proc.stdin.end();
let body = (await new Response(proc.stdout).text()).trim();
await proc.exited;
body = body.replace(/^```html?\s*/i, "").replace(/```\s*$/, "").trim();
if (!body) { console.log("ERR research produced nothing"); process.exit(1); }

const subject = `☕ BREVE · ${topic.slice(0, 60)}`;
const kicker = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:4px;color:${palette.accent};border-bottom:1px solid ${palette.rule};padding-bottom:10px;margin-bottom:16px">BREVE · ON-DEMAND BRIEF</div>`;
const foot = `<p style="color:${palette.muted};font-size:11px;margin-top:24px;font-family:Helvetica,Arial,sans-serif">Requested via Signal · ${todayIn(effectiveTz(await loadSettings()))}</p>`;

let html: string;
let attachments: { filename: string; content: string }[] = [];

if (format === "pdf") {
  const slug = (topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brief").slice(0, 40);
  const htmlPath = join(TOPICS, `${slug}.html`);
  const pdfPath = join(PDFS, `${slug}.pdf`); // binary → asset layer, not the memex
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    :root{${pdfThemeVariables(palette)}}
    @page{size:Letter;margin:0} html,body{background:var(--bg);-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0;color:var(--ink);font-family:Georgia,serif;font-size:12.5pt;line-height:1.55;padding:18mm 16mm}
    h2{font-size:20pt;color:var(--ink);border-bottom:1px solid var(--rule);padding-bottom:8px} a{color:var(--accent)}
    .k{font-family:-apple-system,Helvetica,sans-serif;font-size:9pt;letter-spacing:.28em;color:var(--accent);text-transform:uppercase}
  </style></head><body><div class="k">BREVE · ON-DEMAND BRIEF</div>${body}${foot}</body></html>`;
  await Bun.write(htmlPath, page);
  try {
    await renderPdf(htmlPath, pdfPath);
  } catch (error) {
    console.log(`ERR ${errText(error)}`); process.exit(1);
  }
  attachments = [{ filename: `BREVE-${slug}.pdf`, content: Buffer.from(await Bun.file(pdfPath).arrayBuffer()).toString("base64") }];
  html = `<!DOCTYPE html><html><body style="margin:0;background:${palette.background};color:${palette.text};font-family:Georgia,serif;padding:28px 22px"><div style="max-width:600px;margin:0 auto">${kicker}<p style="font-size:15px">Your briefing on <b>${topic}</b> is attached as a PDF.</p>${foot}</div></body></html>`;
} else {
  html = `<!DOCTYPE html><html><body style="margin:0;background:${palette.background};color:${palette.text};font-family:Georgia,serif;padding:28px 22px"><div style="max-width:600px;margin:0 auto">${kicker}${body}${foot}</div></body></html>`;
}

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ from: config.from, to: [recipient], subject, html, attachments }),
});
const j = (await res.json()) as ResendResponse;
if (!res.ok) { console.log("ERR " + (j?.message || res.status)); process.exit(1); }
console.log("OK " + (j.id || ""));
