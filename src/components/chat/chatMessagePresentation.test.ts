import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./chatSurface.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/memex.css", import.meta.url), "utf8");

describe("chat message hover metadata", () => {
  test("keeps the timestamp in the same hover row as Copy", () => {
    const actions = component.slice(
      component.indexOf('<div className="cmsg-actions">'),
      component.indexOf("</div>", component.indexOf('<div className="cmsg-actions">')),
    );
    expect(actions).toContain("<time");
    expect(actions).toContain('aria-label="Copy message"');
    expect(actions.indexOf("<time")).toBeLessThan(actions.indexOf('aria-label="Copy message"'));
  });

  test("reveals the complete metadata row on message hover or keyboard focus", () => {
    expect(css).toMatch(/\.cmsg-actions\s*\{[^}]*opacity:\s*0/s);
    expect(css).toMatch(
      /\.cmsg:hover \.cmsg-actions,[\s\S]*?\.cmsg-actions:focus-within\s*\{\s*opacity:\s*1/,
    );
    expect(css).toMatch(/\.cmsg-actions time\s*\{[^}]*white-space:\s*nowrap/s);
  });
});
