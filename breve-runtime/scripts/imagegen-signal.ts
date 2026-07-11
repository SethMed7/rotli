#!/usr/bin/env bun
/**
 * BREVE image generation over Signal — "img: <description>".
 * Mirrors the /imagegen skill: Codex CLI (gpt-image-2, ChatGPT sub) for
 * photoreal/all-round; Antigravity `agy` (Nano Banana Pro, Google AI Pro sub)
 * for illustration/logos/in-image text. No metered API keys.
 * Output lands in your storage root (skill convention) — prints "OK <path>".
 * Usage: bun imagegen-signal.ts "<description>"   (--gemini / --codex to force)
 */
import { join } from "node:path";
import { runModel, findAgy, findCodex } from "./run-model";
import { storagePath } from "./config";

const STORE = storagePath();

const argv = process.argv.slice(2);
const forceGemini = argv.includes("--gemini");
const forceCodex = argv.includes("--codex");
const desc = argv.filter((a) => !a.startsWith("--")).join(" ").trim();
if (!desc) { console.error("ERR usage: imagegen-signal.ts <description>"); process.exit(1); }

const ILLUSTRATive = /\b(illustration|illustrated|cartoon|anime|logo|icon|sticker|flat|vector|diagram|infographic|pixel art|watercolor|comic|typography|text saying|with the (words|text))\b/i;
const engine = forceCodex ? "codex" : forceGemini || ILLUSTRATive.test(desc) ? "gemini" : "codex";

const slug = desc.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 6).join("-") || "image";
const DEST = join(STORE, `${slug}-${new Date().toISOString().slice(0, 10)}.png`);

let code = 1;
if (engine === "codex") {
  const prompt = `Use your built-in \`image_gen\` tool to generate this image. Do NOT use the scripts/image_gen.py CLI fallback and do NOT require OPENAI_API_KEY — stay on the built-in tool so this is billed to the subscription.

Description:
${desc}

Quality: medium. Size: 1024x1024 unless the description implies otherwise (use a landscape/portrait size if it's clearly a hero/wallpaper/banner).

After generating, copy the final image to this exact path:
${DEST}

Then print ONLY that absolute path as the final line of your response.`;
  // NOT wrapped in our sandbox-exec: codex SELF-sandboxes via `-s workspace-write` (writes confined
  // to cwd + --add-dir the storage root). Nesting our seatbelt inside codex's fails (sandbox_apply:
  // Operation not permitted, exit 71) — so we rely on codex's native sandbox (same write boundary).
  // `-c mcp_servers={}` isolates ambient MCP servers (no Supabase/Railway OAuth side-effects).
  const codex = findCodex();
  if (!codex) { console.error("ERR codex not found"); process.exit(1); }
  const p = Bun.spawn(
    [codex, "exec", "--skip-git-repo-check", "-s", "workspace-write", "-c", "mcp_servers={}", "--add-dir", STORE, "-C", STORE, "-"],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" }
  );
  p.stdin.write(prompt);
  await p.stdin.end();
  await new Response(p.stdout).text();
  code = await p.exited;
} else {
  const prompt = `Use your image generation capability (Nano Banana / Gemini image) to create this image:

${desc}

Style/quality: medium. Square ~1024x1024 unless the description implies a landscape/portrait/banner aspect, then choose a fitting aspect ratio.

Save the final PNG to this exact absolute path:
${DEST}

Then print ONLY that absolute path as the last line. If you cannot generate images, print exactly NO_IMAGE_CAPABILITY and why.`;
  // Sandboxed: agy can only WRITE the storage root (allowed), so image output still works.
  const agy = findAgy();
  if (!agy) { console.error("ERR agy not found"); process.exit(1); }
  const p = runModel(
    [agy, "-p", prompt, "--add-dir", STORE, "--dangerously-skip-permissions", "--print-timeout", "4m"],
    { stdout: "pipe", stderr: "pipe" }
  );
  await new Response(p.stdout).text();
  code = await p.exited;
}

if (await Bun.file(DEST).exists()) {
  console.log(`OK ${DEST} (${engine})`);
} else {
  console.error(`ERR ${engine} exited ${code}, no image at ${DEST}`);
  process.exit(1);
}
