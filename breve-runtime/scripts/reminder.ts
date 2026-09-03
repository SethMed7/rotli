#!/usr/bin/env bun
/**
 * A CUSTOM reminder routine (2026-07-31): no model call — deliver the user's
 * own text on schedule. Writes the reminder as a brief-shaped markdown file
 * (so it lands in Rotli's Briefs surface — the inApp lane) and sends the
 * signal/email lanes through the existing senders, whose receipts satisfy the
 * scheduler's verifyRun contract (`<stem>.signal` / `<stem>.email`).
 *
 * Inputs ride the scheduler's job env: ROTLI_ROUTINE_ID / LABEL / PROMPT /
 * STEM and ROTLI_BREVE_LANES.
 */
import { join } from "node:path";
import { BREVE, BRIEFS } from "./paths";

const id = process.env.ROTLI_ROUTINE_ID ?? "";
const label = process.env.ROTLI_ROUTINE_LABEL || "Reminder";
const text = (process.env.ROTLI_ROUTINE_PROMPT ?? "").trim();
const stem = process.env.ROTLI_ROUTINE_STEM ?? "";
const lanes = (process.env.ROTLI_BREVE_LANES ?? "inApp").split(",").filter(Boolean);

if (!id || !stem || !text) {
  console.error(`ERR reminder needs ROTLI_ROUTINE_ID, ROTLI_ROUTINE_STEM, and ROTLI_ROUTINE_PROMPT`);
  process.exit(1);
}

// Brief-shaped markdown: the `## Headline` section is what send-brief.ts
// parses into the email subject; the title line is what the Briefs UI shows.
const md = `# 🔔 ${label}

## Headline
${text.split("\n")[0]}

${text}

## Action Items
- ${label}: ${text.split("\n")[0]}
`;
const mdPath = join(BRIEFS, `${stem}.md`);
await Bun.write(mdPath, md);
console.log(`OK wrote ${mdPath}`);

const run = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { cwd: BREVE, stdout: "inherit", stderr: "inherit" });
  return  p.exited;
};

let failed = false;
if (lanes.includes("signal")) {
  const code = await run([
    "bun",
    join(BREVE, "scripts", "send-signal-text.ts"),
    "--file",
    mdPath,
    "--prefix",
    `🔔 ${label}`,
    "--receipt",
    `${stem}.signal`,
  ]);
  // exit 75 = another process is mid-delivery — not a failure of THIS run
  if (code !== 0 && code !== 75) failed = true;
}
if (lanes.includes("email")) {
  const code = await run(["bun", join(BREVE, "scripts", "send-brief.ts"), stem]);
  if (code !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
