// The walkthrough for a connected AI tool that is not ready yet: what to
// install, how to sign in, and how Rotli notices. Pure data — the Settings
// lane cards, the chat's empty state, and Rotli Web's chat setup all render
// the same steps, so the story is told once. Commands are the tools' own
// official ones; Rotli never installs or signs in on the user's behalf.

import { DEFAULT_PRODUCT_NAME } from "../host/registry";
import type { CliDetect } from "../lib/tauri";
import type { ProviderId } from "./models";

export type GuideOs = "mac" | "windows" | "linux";

export interface GuideStep {
  id: "install" | "login" | "check";
  title: string;
  /** A command to run in a terminal, when there is one. */
  command?: string;
  detail: string;
}

/** The user's OS from what the browser reports; Mac when unsure. */
export function guideOs(platformHint: string): GuideOs {
  const hint = platformHint.toLowerCase();
  if (hint.includes("win")) return "windows";
  if (hint.includes("linux") || hint.includes("x11")) return "linux";
  return "mac";
}

const INSTALL: Record<
  Exclude<ProviderId, "antigravity">,
  Record<GuideOs, { command?: string; detail: string }>
> = {
  claude: {
    mac: {
      command: "npm install -g @anthropic-ai/claude-code",
      detail: "Needs Node.js 22 or newer. The installer at claude.com/claude-code works too.",
    },
    linux: {
      command: "npm install -g @anthropic-ai/claude-code",
      detail: "Needs Node.js 22 or newer. The installer at claude.com/claude-code works too.",
    },
    windows: {
      command: "npm install -g @anthropic-ai/claude-code",
      detail: "Needs Node.js 22 or newer. Run it in PowerShell or Windows Terminal.",
    },
  },
  codex: {
    mac: {
      command: "brew install codex",
      detail: "Or `npm install -g @openai/codex` if you don't use Homebrew.",
    },
    linux: { command: "npm install -g @openai/codex", detail: "Needs Node.js." },
    windows: {
      command: "npm install -g @openai/codex",
      detail: "Needs Node.js. Run it in PowerShell or Windows Terminal.",
    },
  },
  cursor: {
    mac: {
      command: "curl https://cursor.com/install -fsS | bash",
      detail:
        "The official installer places `agent` in ~/.local/bin. Open a new terminal afterwards so it is on your PATH.",
    },
    linux: {
      command: "curl https://cursor.com/install -fsS | bash",
      detail:
        "The official installer places `agent` in ~/.local/bin. Open a new terminal afterwards so it is on your PATH.",
    },
    windows: {
      command: "irm 'https://cursor.com/install?win32=true' | iex",
      detail: "Run it in PowerShell, then open a new terminal so `agent` is on your PATH.",
    },
  },
};

const LOGIN: Record<
  Exclude<ProviderId, "antigravity">,
  { command: string; detail: (app: string) => string }
> = {
  claude: {
    command: "claude auth login",
    detail: (app) => `Sign in with your Claude account. ${app} never sees the credential.`,
  },
  codex: {
    command: "codex login",
    detail: (app) => `Sign in with your ChatGPT account. ${app} never sees the credential.`,
  },
  cursor: {
    command: "agent login",
    detail: (app) => `Sign in with your Cursor account. ${app} uses Cursor's read-only Ask mode.`,
  },
};

/** The steps for one lane on one OS, naming the running app `app`.
 * Antigravity has its own card. */
export function connectorGuide(lane: ProviderId, os: GuideOs, app = DEFAULT_PRODUCT_NAME): GuideStep[] {
  if (lane === "antigravity") return [];
  const install = INSTALL[lane][os];
  const login = LOGIN[lane];
  return [
    {
      id: "install",
      title: "Install it",
      ...(install.command ? { command: install.command } : {}),
      detail: install.detail,
    },
    { id: "login", title: "Sign in, in your terminal", command: login.command, detail: login.detail(app) },
    {
      id: "check",
      title: `Come back to ${app}`,
      detail: `${app} notices on its own; Check again asks right now.`,
    },
  ];
}

/** Whether a step is already behind the user, from Rotli's detection. */
export function stepDone(step: GuideStep, detection: CliDetect | undefined): boolean {
  if (!detection) return false;
  if (step.id === "install") return detection.installed;
  if (step.id === "login") return detection.installed && detection.authenticated;
  return detection.installed && detection.authenticated;
}
