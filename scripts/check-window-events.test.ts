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

  test("a documented event no longer in code fails", async () => {
    const r = await run({
      "docs/architecture/window-events.md": doc(["rotli:gone"]),
      "src/lib/tauri.ts": "export {};\n",
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("rotli:gone: documented but no longer used in code");
  });
});
