import { expect, test } from "bun:test";

import { contrast, over } from "./color";
import { deriveMode } from "./derive";
import { audit, failures } from "./gate";

const forest = deriveMode("light", { page: "#f6f1e7", accent: "#3f7d51" }).tokens;

test("the gate measures a token set on its own, whatever produced it", () => {
  expect(failures(audit(forest, "light"))).toEqual([]);
  const tampered = { ...forest, "--text-muted": "#c8c0b0" };
  const failing = failures(audit(tampered, "light")).map((row) => `${row.role} on ${row.on}`);
  expect(failing).toContain("Secondary text on Page");
});

test("a missing token measures as black, so an incomplete set fails", () => {
  const { "--text": _text, ...rest } = deriveMode("dark", { page: "#101814", accent: "#82be96" }).tokens;
  const missing = failures(audit(rest, "dark")).map((row) => `${row.role} on ${row.on}`);
  expect(missing).toContain("Text on the page on Page");
});

test("translucent layers are composited over their surface before measuring", () => {
  const rows = audit(forest, "light");
  const row = rows.find((r) => r.role === "Text, current row" && r.on === "Page row")!;
  expect(row.bg).toBe(over(forest["--accent"]!, 0.11, forest["--ground"]!));
  expect(row.ratio).toBe(contrast(forest["--text"]!, row.bg));
});

test("High raises text on the page and on cards to 7:1 and the accent there to 4.5:1", () => {
  const rows = audit(forest, "light", "high");
  expect(rows.find((r) => r.role === "Text" && r.on === "Card")!.min).toBe(7);
  expect(rows.find((r) => r.role === "Accent fill and focus ring" && r.on === "Page")!.min).toBe(4.5);
  expect(rows.find((r) => r.role === "Accent fill and focus ring" && r.on === "Tint")!.min).toBe(3);
});
