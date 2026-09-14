import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AboutPane, ROTLI_WEBSITE_URL } from "./aboutPane";

test("About names the installed version and links the website by its exact URL", () => {
  const markup = renderToStaticMarkup(<AboutPane version="0.95.1" onOpenWebsite={() => {}} />);
  expect(ROTLI_WEBSITE_URL).toBe("https://sethmedina.com");
  expect(markup.includes('href="https://sethmedina.com"')).toBe(true);
  expect(markup.includes("Website — sethmedina.com")).toBe(true);
  expect(markup.includes("Rotli 0.95.1")).toBe(true);
});

test("without a bundle version the pane says where to find it instead of inventing one", () => {
  const markup = renderToStaticMarkup(<AboutPane version={null} onOpenWebsite={() => {}} />);
  expect(markup.includes("version shown in the Mac app")).toBe(true);
  expect(/Rotli \d/.test(markup)).toBe(false);
});
