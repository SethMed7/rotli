import { describe, expect, test } from "bun:test";
import { legacyWatchUrl, parseWatchlist, serializeWatchlist } from "./watchlist";

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
    const md = ["## Markets (light touch)", "", "Tech-stock signal only — no day-trading content."].join(
      "\n",
    );
    const wl = parseWatchlist(md);
    expect(wl.sections).toHaveLength(1);
    expect(wl.sections[0]!.items).toEqual([]);
    expect(wl.sections[0]!.note).toBe("Tech-stock signal only — no day-trading content.");
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
      '- **Always end with:** a "worth your time" shortlist.',
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
    const md = ["## S", "| Watch | Lens |", "|---|---|", "| Bun | keep |", "|  | drop |"].join("\n");
    expect(parseWatchlist(md).sections[0]!.items).toEqual([{ watch: "Bun", lens: "keep" }]);
  });

  test("native collection data serializes into the scheduler Markdown contract", () => {
    const markdown = serializeWatchlist({
      sections: [
        {
          title: "AI tools",
          items: [
            { watch: "Rotli", lens: "product changes" },
            { watch: "Bun | Node", lens: "compatibility\\runtime" },
          ],
        },
      ],
      preferences: "- Keep it concise.",
    });
    expect(markdown).toContain("## AI tools");
    expect(markdown).toContain("| Bun \\| Node | compatibility\\\\runtime |");
    expect(parseWatchlist(markdown)).toEqual({
      sections: [
        {
          title: "AI tools",
          items: [
            { watch: "Rotli", lens: "product changes" },
            { watch: "Bun | Node", lens: "compatibility\\runtime" },
          ],
        },
      ],
      preferences: "- Keep it concise.",
    });
  });

  test("empty groups remain editable after a save and reload", () => {
    const markdown = serializeWatchlist({
      sections: [{ title: "New group", items: [] }],
      preferences: "",
    });
    expect(parseWatchlist(markdown).sections).toEqual([{ title: "New group", items: [] }]);
  });

  test("group-specific prose survives the native editor round trip", () => {
    const original = {
      sections: [{ title: "Markets", note: "Only material product and policy changes.", items: [] }],
      preferences: "",
    };
    expect(parseWatchlist(serializeWatchlist(original))).toEqual(original);
  });

  test("website sources survive the native editor round trip", () => {
    const original = {
      sections: [{ title: "Runtimes", items: [{ watch: "Bun", lens: "Releases", url: "https://bun.sh/" }] }],
      preferences: "",
    };
    const markdown = serializeWatchlist(original);
    expect(markdown).toContain("| Watch | Lens | Website |");
    expect(markdown).toContain("<https://bun.sh/>");
    expect(parseWatchlist(markdown)).toEqual(original);
  });

  test("reads a source from either a website column or a linked topic", () => {
    const withColumn =
      "## Tools\n| Watch | Lens | Website |\n|---|---|---|\n| Bun | releases | [Official](https://bun.sh/) |";
    const linkedTopic = "## Tools\n| Watch | Lens |\n|---|---|\n| [**Bun**](https://bun.sh/) | releases |";
    expect(parseWatchlist(withColumn).sections[0]!.items[0]!.url).toBe("https://bun.sh/");
    expect(parseWatchlist(linkedTopic).sections[0]!.items[0]).toEqual({
      watch: "Bun",
      lens: "releases",
      url: "https://bun.sh/",
    });
  });

  test("legacy two-column topics receive canonical source suggestions", () => {
    expect(legacyWatchUrl("OpenClaw")).toBe("https://openclaw.ai/");
    expect(legacyWatchUrl("Unknown topic")).toBe("");
  });
});
