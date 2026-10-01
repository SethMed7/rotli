import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { feedbackUrl } from "../../lib/feedback";
import { AboutPane, BUILT_IN, ROTLI_WEBSITE_URL } from "./aboutPane";

const FEEDBACK = feedbackUrl("0.95.1", "mac");

test("About names the installed version and links the website by its exact URL", () => {
  const markup = renderToStaticMarkup(
    <AboutPane version="0.95.1" feedbackUrl={FEEDBACK} onOpenUrl={() => {}} />,
  );
  expect(ROTLI_WEBSITE_URL).toBe("https://sethmedina.com");
  expect(markup.includes('href="https://sethmedina.com"')).toBe(true);
  expect(markup.includes("Website — sethmedina.com")).toBe(true);
  expect(markup.includes("Rotli 0.95.1")).toBe(true);
});

test("without a bundle version the pane says where to find it instead of inventing one", () => {
  const markup = renderToStaticMarkup(
    <AboutPane version={null} feedbackUrl={FEEDBACK} onOpenUrl={() => {}} />,
  );
  expect(markup.includes("version shown in the Mac app")).toBe(true);
  expect(/Rotli \d/.test(markup)).toBe(false);
});

test("Send feedback links the prefilled issue and says that issues are public", () => {
  const markup = renderToStaticMarkup(
    <AboutPane version="0.95.1" feedbackUrl={FEEDBACK} onOpenUrl={() => {}} />,
  );
  expect(markup.includes(`href="${FEEDBACK.replaceAll("&", "&amp;")}"`)).toBe(true);
  expect(markup.includes("Send feedback")).toBe(true);
  expect(markup.includes("Issues are public")).toBe(true);
});

test("About credits the open-source editors built in: Excalidraw and Univer, by their sites", () => {
  const markup = renderToStaticMarkup(
    <AboutPane version="1.8.0" feedbackUrl={FEEDBACK} onOpenUrl={() => {}} />,
  );
  for (const editor of BUILT_IN) {
    expect(markup.includes(`href="${editor.url}"`)).toBe(true);
    expect(markup.includes(`>${editor.name}</a>`)).toBe(true);
  }
  expect(markup).toContain("Excalidraw</a> draws your boards, and ");
  expect(markup).toContain("Univer</a> edits your Word documents.");
});
