import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { HIDEABLE } from "../../lib/hideable";
import { VisibilitySection, visibilityItems } from "./visibilitySettings";

const render = (hidden: Parameters<typeof VisibilitySection>[0]["hidden"]) =>
  renderToStaticMarkup(
    <VisibilitySection hidden={hidden} setShown={() => {}} onShowAll={() => {}} items={HIDEABLE} />,
  );

describe("Settings → Show in Rotli", () => {
  test("one switch per item, grouped by where it sits, all on by default", () => {
    const markup = render({});
    for (const group of ["Title bar", "Sidebar", "Sidebar footer", "Tabs"])
      expect(markup).toContain(`aria-label="${group}"`);
    expect(markup.match(/role="switch"/g)).toHaveLength(HIDEABLE.length);
    expect(markup).not.toContain('aria-checked="false"');
    expect(markup).not.toContain("Show everything");
  });

  test("a hidden item's switch is off, and everything can come back at once", () => {
    const markup = render({ overview: true, browserButton: true });
    expect(markup.match(/aria-checked="false"/g)).toHaveLength(2);
    expect(markup).toContain("Show everything (2 hidden)");
  });

  test("Rotli Web never offers to hide the palette's only door, or a Browser button it lacks", () => {
    const web = visibilityItems("web").map((item) => item.id);
    expect(web).not.toContain("search");
    expect(web).not.toContain("browserButton");
    const mac = visibilityItems("desktop").map((item) => item.id);
    expect(mac).toContain("search");
    expect(mac).toContain("browserButton");
  });
});
