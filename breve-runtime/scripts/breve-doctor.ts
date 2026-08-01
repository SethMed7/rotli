#!/usr/bin/env bun
/**
 * BREVE doctor — the self-healing loop. Runs every 30 min via its launchd job.
 * Detect → heal what's safe → propose what isn't → report.
 *
 * Philosophy (see ../docs/self-healing.md): Breve fixes its own plumbing silently
 * (restart the daemon / local model), but anything that *produces output* (rerunning a
 * missed brief) goes through the CONFIRM flow — the assistant proposes, you decide.
 * Quiet when healthy: no message unless something was wrong.
 */
import { join } from "node:path";
import { appendFileSync } from "node:fs";
import { BREVE, BRIEFS, AUDIOS, PDFS } from "./paths";
import { knowledgePath, launchdOrg } from "./config";
import { loadSettings, effectiveTz, todayIn, minutesNowIn, parseHM } from "./timectx";
import { bunBin, sendSignal } from "./bin";
import { LLM } from "./llm";
import { findingFingerprints, newFindings } from "./doctor-findings";
import { errText } from "./err-text";

// DRY: run every check but skip all healing side-effects (no kickstart/open/Signal/state write).
const DRY = process.env.BREVE_DOCTOR_DRY === "1";
const SIGNAL_ENABLED = (process.env.ROTLI_BREVE_LANES ?? "signal").split(",").includes("signal");

const { bot, owner } = await Bun.file(join(BREVE, "signal.json")).json();
const STATE_PATH = join(BREVE, "logs", ".doctor-state.json");
const AWAITING_ACTION = join(BREVE, "signal", "awaiting-action.json");
const FAILLOG = join(BREVE, "logs", "failures.log");
// The owner's day, not UTC and not the bare system clock (travel-aware).
const settings = await loadSettings();
const tz = effectiveTz(settings);
const today = todayIn(tz);
const mins = minutesNowIn(tz);

type State = {
  failSize: number;
  proposed: Record<string, string>;
  healedNote: Record<string, string>;
  activeFindingFingerprints?: string[];
};
const firstRun = !(await Bun.file(STATE_PATH).exists());
const state: State = (await Bun.file(STATE_PATH).json().catch(() => null)) ?? { failSize: 0, proposed: {}, healedNote: {} };

const findings: string[] = [];
const healed: string[] = [];

// Crash-proof: a missing/unspawnable binary returns code 127 instead of throwing ENOENT.
async function sh(cmd: string[]): Promise<{ code: number; out: string }> {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out: (o + "\n" + e).trim() };
  } catch (err) {
    return { code: 127, out: `${cmd[0]} not found or failed: ${errText(err)}` };
  }
}

// ── 1. Signal daemon alive? (safe to heal silently) ──────────────────────────
async function checkDaemon() {
  // Rotli's scheduler is now the process supervisor and restarts Signal with
  // backoff. The old launchctl probe would falsely diagnose every managed run.
  if (process.env.ROTLI_BREVE_HOME) return;
  const { out } = await sh(["launchctl", "list"]);
  const line = out.split("\n").find((l) => l.includes(`${launchdOrg()}.breve-signal`));
  const pid = line?.trim().split(/\s+/)[0];
  if (pid && pid !== "-") return;
  if (DRY) { findings.push("Signal daemon is DOWN — would restart it (DRY)."); return; }
  await sh(["launchctl", "kickstart", "-k", `gui/${process.getuid!()}/${launchdOrg()}.breve-signal`]);
  await Bun.sleep(4000);
  const after = (await sh(["launchctl", "list"])).out.split("\n").find((l) => l.includes("breve-signal"));
  const ok = after && after.trim().split(/\s+/)[0] !== "-";
  (ok ? healed : findings).push(ok ? "Signal daemon was down — restarted it." : "Signal daemon is DOWN and restart failed — needs the Mac.");
}

// ── 2. Local model tier alive? (the default LLM provider — MLX on Mac; safe to heal silently) ──
async function checkLocalModel() {
  const name = `local model (${LLM.provider})`;
  const up = async () => {
    try { return (await fetch(`${LLM.endpoint}/api/version`, { signal: AbortSignal.timeout(3000) })).ok; }
    catch { return false; }
  };
  if (await up()) return;
  if (DRY) { findings.push(`${name} is DOWN — would restart it (DRY).`); return; }
  await sh(["launchctl", "kickstart", "-k", `gui/${process.getuid!()}/${LLM.launchdLabel}`]);
  await Bun.sleep(5000);
  if (await up()) healed.push(`${name} was down — restarted it (local tier back).`);
  else findings.push(`${name} is DOWN and restart failed — local tier is offline (chat falls back to Claude).`);
}

// ── 2b. Proton Bridge alive? (only the proton mailbox depends on it) ─────────
async function checkBridge() {
  const up = async () => {
    try {
      const sock = await Bun.connect({ hostname: "127.0.0.1", port: 1143, socket: { data() {} } });
      sock.end();
      return true;
    } catch { return false; }
  };
  if (await up()) return;
  if (DRY) { findings.push("Proton Bridge is down — would reopen it (DRY)."); return; }
  await sh(["open", "-g", "-a", "Proton Mail Bridge"]); // -g: launch without stealing focus
  await Bun.sleep(8000);
  if (await up()) healed.push("Proton Bridge was closed — reopened it (proton mail back).");
  else findings.push("Proton Bridge is down and won't relaunch — proton mail is offline (gmail/msd unaffected).");
}

// ── 3. Expected daily artifacts (output-producing → propose, never auto-run) ─
async function checkArtifacts() {
  const GRACE = 45; // minutes past scheduled delivery before we call it missed
  const t = (meal: "morning" | "lunch" | "night") => parseHM(settings.deliveryTimes[meal]) + GRACE;
  const expect: Array<{ after: number; file: string; dir?: string; script: string; what: string }> = [
    { after: t("morning"), file: `${today}.md`, script: "morning-brief.sh", what: "morning brief" },
    { after: t("morning"), file: `${today}.mp3`, dir: AUDIOS, script: "morning-brief.sh", what: "morning audio" },
    { after: t("morning"), file: `${today}.pdf`, dir: PDFS, script: "morning-brief.sh", what: "morning PDF" },
    { after: t("lunch"), file: `${today}-lunch.md`, script: "lunch-brief.sh", what: "lunch brief" },
    { after: t("night"), file: `${today}-night.md`, script: "night-brief.sh", what: "night brief" },
  ];
  for (const e of expect) {
    if (mins < e.after) continue;
    if (await Bun.file(join(e.dir ?? BRIEFS, e.file)).exists()) continue;
    const key = `${today}:${e.script}`;
    if (state.proposed[key]) continue; // already proposed today — don't nag
    if (DRY) { findings.push(`Today's ${e.what} is missing — would propose scripts/${e.script} (DRY).`); break; }
    if (await Bun.file(AWAITING_ACTION).exists()) { findings.push(`Today's ${e.what} is missing (another action is pending — will re-propose later).`); continue; }
    await Bun.write(AWAITING_ACTION, JSON.stringify({ action: "run-script", script: e.script, note: `doctor: today's ${e.what} is missing` }));
    state.proposed[key] = new Date().toISOString();
    findings.push(`Today's ${e.what} never generated.\n⚙️ Proposed: run scripts/${e.script} — reply CONFIRM to run it, or "cancel".`);
    break; // one proposal at a time; a rerun usually fixes the siblings too
  }
}

// ── 4. New failures since last check ─────────────────────────────────────────
async function checkFailures() {
  const f = Bun.file(FAILLOG);
  if (!(await f.exists())) return;
  const size = f.size;
  if (size > state.failSize && !firstRun) { // first run baselines; history isn't "new"
    const fresh = (await f.text()).slice(state.failSize).trim().split("\n").filter(Boolean);
    if (fresh.length) findings.push(`${fresh.length} new failure(s) logged:\n${fresh.slice(-3).join("\n").slice(0, 400)}`);
  }
  state.failSize = size;
}

// ── 5. Disk sanity ────────────────────────────────────────────────────────────
async function checkDisk() {
  const { out } = await sh(["df", "-g", "/"]);
  const avail = parseInt(out.split("\n")[1]?.split(/\s+/)[3] ?? "999");
  if (avail < 10) findings.push(`Disk is low: ${avail}GB free.`);
}

// ── 6. memex structure invariants (the knowledge base Breve reads) ───────────
async function checkMemex() {
  const script = join(knowledgePath(), "scripts", "validate.ts");
  if (!(await Bun.file(script).exists())) return;
  const bun = bunBin();
  if (!bun) { findings.push("bun not on PATH — can't validate the memex"); return; }
  const { code, out } = await sh([bun, script]);
  if (code !== 0) {
    const errs = out.split("\n").filter((l) => l.includes("✗")).slice(0, 3).join("\n");
    findings.push(`memex invariants failed (a binary or broken asset ref slipped in):\n${errs || out.slice(-300)}`);
  }
}

await checkDaemon();
await checkLocalModel();
await checkBridge();
await checkArtifacts();
await checkFailures();
await checkDisk();
await checkMemex();

if (DRY) {
  console.log(`[doctor] DRY run — no side-effects.\n  healed: ${JSON.stringify(healed, null, 2)}\n  findings: ${JSON.stringify(findings, null, 2)}`);
  process.exit(0);
}

const reportableFindings = newFindings(findings, state.activeFindingFingerprints ?? []);
state.activeFindingFingerprints = findingFingerprints(findings);
await Bun.write(STATE_PATH, JSON.stringify(state));

if (!reportableFindings.length && !healed.length) {
  const status = findings.length
    ? `${findings.length} unchanged finding(s) still active; notification suppressed`
    : "all healthy";
  console.log(`[doctor] ${new Date().toISOString()} ${status}`);
  process.exit(0);
}

const msg = `🩺 Breve check-up:\n${[...healed.map((h) => `✓ ${h}`), ...reportableFindings.map((f) => `⚠ ${f}`)].join("\n")}`;
console.log(`[doctor] ${msg}`);
if (!SIGNAL_ENABLED || await sendSignal(bot, owner, msg)) process.exit(0);
try { appendFileSync(FAILLOG, `${new Date().toISOString()} [doctor] could not reach Signal — findings logged only\n`); } catch {}
console.error("[doctor] could not reach Signal — findings logged only");
