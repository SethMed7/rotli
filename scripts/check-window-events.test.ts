// check:window-events pins the cross-webview event registry: every event
// literal is documented, and every documented event has a sender and a
// receiver in code.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const checker = join(import.meta.dir, "check-window-events.mjs");

async function run(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "rotli-window-events-"));
  mkdirSync(join(root, "src-tauri/src"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, source);
  }
  const proc = Bun.spawn([process.execPath, checker], {
    env: { ...process.env, ROTLI_CHECK_ROOT: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

const doc = (rows: string[]) =>
  `# Window events\n\n| Event | Notes |\n|---|---|\n${rows.map((r) => `| \`${r}\` | x |\n`).join("")}`;

describe("check:window-events", () => {
  test("a documented event wired on both sides passes", async () => {
    const r = await run({
      "docs/architecture/window-events.md": doc(["rotli:appearance"]),
      "src/lib/tauri.ts": 'emit("rotli:appearance"); listen("rotli:appearance");\n',
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("1 events documented");
  });

  test("an event literal missing from the registry fails", async () => {
    const r = await run({
      "docs/architecture/window-events.md": doc([]),
      "src/lib/tauri.ts": 'emit("rotli:new-thing"); listen("rotli:new-thing");\n',
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      "rotli:new-thing: used in src/lib/tauri.ts but not in docs/architecture/window-events.md",
    );
  });

  test("an event with a sender but no receiver fails", async () => {
    const r = await run({
      "docs/architecture/window-events.md": doc(["rotli:lonely"]),
      "src-tauri/src/lib.rs": 'app.emit("rotli:lonely", ());\n',
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("rotli:lonely: appears once");
  });

  // window targeting (review of PR 199): Rust addresses per window, and the
  // webview hears only its own copy
  test("a Rust .emit of a per-window event fails; the broadcast is allowed", async () => {
    const r = await run({
      "docs/architecture/window-events.md": doc(["rotli:close-tab", "rotli:vault-changed"]),
      "src-tauri/src/lib.rs": 'window.emit("rotli:close-tab", ()); app.emit("rotli:vault-changed", ());\n',
      "src/lib/tauri.ts": 'listenHere("rotli:close-tab"); listen("rotli:vault-changed");\n',
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('`.emit("rotli:close-tab")` reaches every window');
    expect(r.stderr).not.toContain('rotli:vault-changed")` reaches');
  });

  test("a bare listen of an event Rust addresses to one window fails", async () => {
    const r = await run({
      "docs/architecture/window-events.md": doc(["rotli:quick-show"]),
      "src-tauri/src/quick_window.rs": 'app.emit_to(LABEL, "rotli:quick-show", ());\n',
      "src/lib/tauri.ts": 'listen("rotli:quick-show", () => cb());\n',
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("rotli:quick-show is addressed to one window by Rust");
  });

  test("an addressed event heard with listenHere or a target passes", async () => {
    const r = await run({
      "docs/architecture/window-events.md": doc(["rotli:quick-show", "rotli:flush-before-quit"]),
      "src-tauri/src/lib.rs":
        'app.emit_to(LABEL, "rotli:quick-show", ()); app.emit_to(label, "rotli:flush-before-quit", ());\n',
      "src/lib/tauri.ts":
        'export function listenHere(event, handler) {\n  return listen(event, handler, { target: label() });\n}\nlistenHere("rotli:quick-show", () => cb());\nlisten("rotli:flush-before-quit", (e) => run(e), { target: label() });\n',
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("2 window-addressed events heard per window");
  });

  test("a listenHere that drops its target fails", async () => {
    const r = await run({
      "docs/architecture/window-events.md": doc(["rotli:quick-show"]),
      "src-tauri/src/lib.rs": 'app.emit_to(LABEL, "rotli:quick-show", ());\n',
      "src/lib/tauri.ts":
        'export function listenHere(event, handler) {\n  return listen(event, handler);\n}\nlistenHere("rotli:quick-show", () => cb());\n',
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("listenHere must pass { target }");
  });

  test("a documented event no longer in code fails", async () => {
    const r = await run({
      "docs/architecture/window-events.md": doc(["rotli:gone"]),
      "src/lib/tauri.ts": "export {};\n",
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("rotli:gone: documented but no longer used in code");
  });
});
