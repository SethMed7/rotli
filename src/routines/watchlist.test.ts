import { describe, expect, test } from "bun:test";
import { parseWatchlist } from "./watchlist";

describe("parseWatchlist", () => {
  test("parses a section's watch/lens table", () => {
    const md = [
      "# Breve Watchlist",
      "",
      "## Runtimes & JS ecosystem",
      "",
      "| Watch | Lens |",
      "|-------|------|",
      "| **Bun** | Favorite runtime; track Node-compat gaps. |",
      "| **Node.js** | The other side of the same question. |",
    ].join("\n");

    const wl = parseWatchlist(md);
    expect(wl.sections).toHaveLength(1);
    const s = wl.sections[0]!;
    expect(s.title).toBe("Runtimes & JS ecosystem");
    expect(s.items).toEqual([
      { watch: "Bun", lens: "Favorite runtime; track Node-compat gaps." },
      { watch: "Node.js", lens: "The other side of the same question." },
    ]);
  });

  test("strips markdown emphasis from the watch name, keeps the lens raw", () => {
    const md = [
      "## AI labs",
      "| Watch | Lens |",
      "|---|---|",
      "| **Anthropic / Claude Code** | Primary tools. **Bun** downstream effects. |",
    ].join("\n");
    const item = parseWatchlist(md).sections[0]!.items[0]!;
    expect(item.watch).toBe("Anthropic / Claude Code");
    expect(item.lens).toBe("Primary tools. **Bun** downstream effects.");
  });

  test("handles multiple sections", () => {
    const md = [
      "## Runtimes",
      "| Watch | Lens |",
      "|---|---|",
      "| Bun | one |",
      "",
      "## Chess",
      "| Watch | Lens |",
      "|---|---|",
      "| Magnus | results |",
      "| Hikaru | games |",
    ].join("\n");
    const wl = parseWatchlist(md);
    expect(wl.sections.map((s) => s.title)).toEqual(["Runtimes", "Chess"]);
    expect(wl.sections[1]!.items).toHaveLength(2);
  });

  test("a prose-only section yields an empty items array", () => {
    const md = [
      "## Markets (light touch)",
      "",
      "Tech-stock signal only — no day-trading content.",
    ].join("\n");
    const wl = parseWatchlist(md);
    expect(wl.sections).toHaveLength(1);
    expect(wl.sections[0]!.items).toEqual([]);
  });

  test("an empty table (header + separator, no rows) yields no items", () => {
    const md = ["## Empty", "| Watch | Lens |", "|---|---|", ""].join("\n");
    const wl = parseWatchlist(md);
    expect(wl.sections[0]!.items).toEqual([]);
  });

  test("lifts the Brief preferences block out of sections", () => {
    const md = [
      "## Runtimes",
      "| Watch | Lens |",
      "|---|---|",
      "| Bun | one |",
      "",
      "## Brief preferences",
      "",
      "- **Length:** a 5–10 minute read.",
      "- **Always end with:** a \"worth your time\" shortlist.",
    ].join("\n");
    const wl = parseWatchlist(md);
    expect(wl.sections.map((s) => s.title)).toEqual(["Runtimes"]);
    expect(wl.preferences).toContain("5–10 minute read");
    expect(wl.preferences).toContain("worth your time");
  });

  test("blank input is empty, not a throw", () => {
    const wl = parseWatchlist("");
    expect(wl.sections).toEqual([]);
    expect(wl.preferences).toBe("");
  });

  test("skips rows with an empty watch cell", () => {
    const md = [
      "## S",
      "| Watch | Lens |",
      "|---|---|",
      "| Bun | keep |",
      "|  | drop |",
    ].join("\n");
    expect(parseWatchlist(md).sections[0]!.items).toEqual([{ watch: "Bun", lens: "keep" }]);
  });
});
