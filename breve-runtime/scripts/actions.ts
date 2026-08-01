/**
 * Breve proposed-action helpers — pure, testable. The deep tier can't run installs but it CAN
 * write pending-action.json; these functions name + validate + preview what it staged so the
 * daemon can show Seth the real thing (not just a path) before he CONFIRMs. Tight breve-only
 * allowlist: maintenance scripts must live under breveRoot. Scheduling belongs
 * exclusively to Rotli, so legacy install/uninstall actions are rejected.
 */
import { stat } from "node:fs/promises";
import type { PendingAction } from "./wire-types";

export const plainName = (s: unknown): boolean => typeof s === "string" && /^[\w.-]+$/.test(s) && !s.includes("..");

/** The validator's input is whatever a model wrote into pending-action.json, so
 * it arrives as `unknown`. Anything that is not a JSON object validates as the
 * empty action and falls through to the "unknown action" refusal. */
function asAction(input: unknown): PendingAction {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as PendingAction) : {};
}

export function describeAction(a: PendingAction): string {
  switch (a.action) {
    case "install-launchd": return `install + load scheduled job ${a.plist}`;
    case "uninstall-launchd": return `unload + remove scheduled job ${a.label}`;
    case "chmod-script": return `make scripts/${a.script} executable`;
    case "run-script": return `run scripts/${a.script} ${Array.isArray(a.args) ? a.args.join(" ") : ""}`.trim();
    default: return JSON.stringify(a).slice(0, 200);
  }
}

export async function validateAction(breveRoot: string, input: unknown): Promise<string | null> {
  const a = asAction(input);
  switch (a.action) {
    case "install-launchd": {
      return "Rotli owns Breve scheduling; individual launchd jobs are disabled";
    }
    case "uninstall-launchd":
      return "Rotli owns Breve scheduling; individual launchd jobs are disabled";
    case "chmod-script":
    case "run-script": {
      if (!plainName(a.script)) return "script must be a plain filename in breve/scripts/";
      if (!(await Bun.file(`${breveRoot}/scripts/${a.script}`).exists())) return `scripts/${a.script} not found`;
      if (a.action === "run-script" && a.args !== undefined &&
          !(Array.isArray(a.args) && a.args.every((x: unknown) => typeof x === "string" && /^[\w@.=:-]*$/.test(x))))
        return "args must be simple flag/word strings";
      return null;
    }
    default:
      return `unknown action "${a.action}"`;
  }
}

// Short preview of a breve script so a run/chmod confirm shows the ACTUAL content (size + mtime +
// first ~25 lines), not just a path. Flags a fresh edit (mtime within 10 min) — the model could
// write+stage a script in one turn, so Seth sees that warning before approving.
export async function previewScript(breveRoot: string, script: string): Promise<string> {
  const path = `${breveRoot}/scripts/${script}`;
  try {
    const st = await stat(path);
    const ageMs = Date.now() - st.mtimeMs;
    const lines = (await Bun.file(path).text()).split("\n").slice(0, 25);
    const fresh = ageMs < 10 * 60_000 ? `\n⚠ NOTE: this script was modified ${Math.max(1, Math.round(ageMs / 60_000))}m ago` : "";
    return `scripts/${script} — ${st.size} bytes, modified ${new Date(st.mtimeMs).toLocaleString()}${fresh}\n┄┄┄\n${lines.join("\n")}${lines.length >= 25 ? "\n… (truncated)" : ""}\n┄┄┄`;
  } catch (e) {
    return `(couldn't preview scripts/${script}: ${String(e).slice(0, 120)})`;
  }
}
