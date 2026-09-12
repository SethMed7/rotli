import { expect, test } from "bun:test";

import { PROVIDER_IDS } from "../ai/models";
import { providerReady, startSetupDetection, useSetupDetection } from "./setupDetection";

test("a client counts as ready only when installed AND signed in", () => {
  expect(providerReady(undefined)).toBe(false);
  expect(providerReady({ installed: true, authenticated: false, version: "1" })).toBe(false);
  expect(providerReady({ installed: false, authenticated: true, version: null })).toBe(false);
  expect(providerReady({ installed: true, authenticated: true, version: "1" })).toBe(true);
});

test("detection starts once and, outside the shell, settles every lane to not installed", async () => {
  startSetupDetection();
  startSetupDetection();
  expect(useSetupDetection.getState().started).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { detections, local } = useSetupDetection.getState();
  for (const provider of PROVIDER_IDS) {
    expect(detections[provider]).toEqual({ installed: false, authenticated: false, version: null });
  }
  expect(local).toEqual([]);
});
