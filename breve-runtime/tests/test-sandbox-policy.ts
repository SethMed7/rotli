import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BREVE_CODE_ROOT, buildProfile } from "../scripts/sandbox";

describe("Breve remote-model sandbox", () => {
  test("admin can read but never write Rotli's immutable runtime bundle", () => {
    const vault = join(
      process.env.TMPDIR ?? "/tmp",
      `rotli-breve-code-policy-${process.pid}-${Date.now()}`,
    );
    try {
      mkdirSync(vault, { recursive: true });
      const roots = {
        readRoots: [vault, BREVE_CODE_ROOT],
        writeRoots: [vault],
      };

      const profile = buildProfile(roots);
      const codeAllow = `  (subpath ${JSON.stringify(BREVE_CODE_ROOT)})`;
      expect(profile).toContain(codeAllow);
      expect(profile.lastIndexOf(codeAllow)).toBeGreaterThan(
        profile.indexOf(`(deny file-read* (subpath ${JSON.stringify(join(vault, ".rotli"))}))`),
      );
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("denies secure and tainted reads plus every AI write to a locked file", () => {
    const root = join(process.env.TMPDIR ?? "/tmp", `rotli-breve-sandbox-${process.pid}-${Date.now()}`);
    try {
      mkdirSync(join(root, "wiki", "_inbox"), { recursive: true });
      mkdirSync(join(root, "chats"), { recursive: true });
      mkdirSync(join(root, "storage"), { recursive: true });
      const secure = join(root, "wiki", "_inbox", "private.md");
      const locked = join(root, "wiki", "_inbox", "locked.md");
      const ordinary = join(root, "wiki", "_inbox", "ordinary.md");
      const tainted = join(root, "chats", "tainted.md");
      writeFileSync(secure, "---\nsecure: true\n---\n\nprivate\n");
      writeFileSync(locked, "---\nlocked: true\n---\n\nreadable, not editable\n");
      writeFileSync(ordinary, "---\ntitle: Ordinary\n---\n\npublic\n");
      writeFileSync(tainted, "---\nsecureContext: true\n---\n\nderived private text\n");

      const profile = buildProfile({
        readRoots: [root, join(root, "storage")],
        writeRoots: [root, join(root, "storage")],
      });

      expect(profile).toContain(`(deny file-read* (literal ${JSON.stringify(secure)}))`);
      expect(profile).toContain(`(deny file-write* (literal ${JSON.stringify(secure)}))`);
      expect(profile).toContain(`(deny file-write* (literal ${JSON.stringify(locked)}))`);
      expect(profile).toContain(`(deny file-read* (literal ${JSON.stringify(tainted)}))`);
      expect(profile).not.toContain(`(deny file-read* (literal ${JSON.stringify(ordinary)}))`);
      expect(profile).toContain(`(deny file-read* (subpath ${JSON.stringify(join(root, ".rotli"))}))`);
      expect(profile).toContain(
        `(deny file-read* (subpath ${JSON.stringify(join(root, "wiki", "_secure"))}))`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
