import { afterEach, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { useUiStore } from "../../state/ui";
import { AppIconSettings } from "./appIconSettings";

const original = useUiStore.getState().appIcon;
afterEach(() => useUiStore.setState({ appIcon: original }));

test("web explains availability without mounting Dock choices or images", () => {
  useUiStore.setState({ appIcon: "black" });
  const html = renderToStaticMarkup(<AppIconSettings platform="web" />);
  expect(html).toContain("App icon");
  expect(html).toContain("In the Mac app.");
  expect(html).not.toContain("<button");
  expect(html).not.toContain("<img");
  expect(useUiStore.getState().appIcon).toBe("black");
});

test("desktop keeps all released icon choices and the saved selection", () => {
  useUiStore.setState({ appIcon: "black" });
  const html = renderToStaticMarkup(<AppIconSettings platform="desktop" />);
  // toggle buttons (aria-pressed) belong in a group; a radiogroup needs radios
  expect(html).toContain('role="group" aria-label="App icon"');
  expect(html).not.toContain("radiogroup");
  expect(html).toContain("Pick the Dock icon");
  for (const name of ["Default", "Paper", "Charcoal", "Clay", "Black", "Tesven"])
    expect(html).toContain(`<span class="appicon-label">${name}</span>`);
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  expect(html).toContain('class="appicon sel" aria-pressed="true"><img class="appicon-tile" src=');
  expect(html).not.toContain("In the Mac app.");
});
