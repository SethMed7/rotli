import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const proposal = readFileSync(
  new URL("../docs/decisions/2026-07-22-secure-organizer-and-sheet-metadata.md", import.meta.url),
  "utf8",
);

describe("revised secure-organizer proposal", () => {
  test("keeps secure metadata local, dual-consented, bounded, and repair-first", () => {
    expect(proposal).toContain("secure organizer not implemented");
    expect(proposal).toMatch(/legacy\s+or externally moved state/);
    expect(proposal).toContain("Remote providers receive no secure-derived envelope");
    expect(proposal).toContain("organize_secure_notes_with_local_ai");
    expect(proposal).toContain("local_ai_allowed: true");
    expect(proposal).toContain("summary`: plain text, at most 200 characters");
    expect(proposal).toContain("secret detector runs over every field");
    expect(proposal).toContain("Rust and TypeScript validate the same limits independently");
  });
});
