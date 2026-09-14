import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { COMING_SOON_CAPTION, launchFeatures } from "../../lib/featurePolicy";
import { VoiceSettings } from "./voiceSettings";

const render = (available: boolean, readAloud = false) =>
  renderToStaticMarkup(
    <VoiceSettings
      available={available}
      readAloud={readAloud}
      voice="af_bella"
      onReadAloud={() => {}}
      onVoice={() => {}}
    />,
  );

test("a stable build shows Voice as coming soon with every control inert", () => {
  const markup = render(launchFeatures(false).voice, true);
  expect(markup.includes(COMING_SOON_CAPTION)).toBe(true);
  const buttons = markup.match(/<button[^>]*>/g) ?? [];
  expect(buttons.length).toBe(2);
  expect(
    buttons.every((button) => button.includes('aria-disabled="true"') && button.includes("disabled")),
  ).toBe(true);
  // no voice picker, and a persisted "on" never renders as selected
  expect(markup.includes("Bella")).toBe(false);
  expect(markup.includes('aria-pressed="true">Read replies aloud')).toBe(false);
});

test("a development build keeps the live read-aloud controls", () => {
  const markup = render(launchFeatures(true).voice, true);
  expect(markup.includes("Coming soon")).toBe(false);
  expect(markup.includes("aria-disabled")).toBe(false);
  expect(markup.includes(">Bella</button>")).toBe(true);
});
