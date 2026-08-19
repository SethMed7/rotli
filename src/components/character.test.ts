import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const characterSource = readFileSync(new URL("character.tsx", import.meta.url), "utf8");
const artSource = readFileSync(new URL("characterArt.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("settingsSurface.tsx", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("chat/chatSurface.tsx", import.meta.url), "utf8");
const paneSource = readFileSync(new URL("paneTree.tsx", import.meta.url), "utf8");
const bucketHatFrontInk = readFileSync(
  new URL("../assets/characters/accessories/bucket-hat-ink.svg", import.meta.url),
  "utf8",
);
const bucketHatThreeQuarterInk = readFileSync(
  new URL("../assets/characters/accessories/bucket-hat-three-quarter-ink.svg", import.meta.url),
  "utf8",
);
const bucketHatSideInk = readFileSync(
  new URL("../assets/characters/accessories/bucket-hat-side-ink.svg", import.meta.url),
  "utf8",
);

describe("quokka personalization", () => {
  test("one renderer owns custom body color, explicit ink, and independently layered accessories", () => {
    expect(characterSource).toContain("quokkaFill(resolvedTreatment)");
    expect(characterSource).toContain('resolvedAccessory === "none"');
    expect(characterSource).toContain("quokka-body-layer");
    expect(characterSource).toContain("quokka-ink-layer");
    expect(characterSource).toContain("quokka-accessory-layer");
    expect(characterSource).toContain("quokkaAccessoryColor(accessoryHue)");
    expect(characterSource).toContain("quokkaAccessoryPlacement(resolvedName, resolvedAccessory)");
    expect(characterSource).not.toContain("quokkaAccessoryForegroundPatches");
    expect(characterSource).not.toContain("quokka-accessory-detail-layer");
    expect(artSource).toContain("thoughtful: { body: thoughtfulBody");
    expect(artSource).toContain('"bucket-hat": {');
    expect(artSource).toContain("color: bucketHatColor");
    expect(artSource).toContain("ink: bucketHatInk");
    expect(artSource).toContain("color: bucketHatThreeQuarterColor");
    expect(artSource).toContain("color: bucketHatSideColor");
    expect(artSource).not.toContain("scarfAccessory");
    expect(characterSource).toContain("accessoryArtSet.poses?.[resolvedName]");
    expect(characterSource).toContain('resolvedAccessory === "bucket-hat"');
    expect(characterSource).toContain("BUCKET_HAT_OCCLUSION_EDGE");
    expect(characterSource).toContain("bucketHatBodyClip(accessoryPlacement, resolvedName)");
    expect(characterSource).toContain("...maskStyle(layered.body), ...bodyHatClip");
    expect(characterSource).toMatch(/style=\{bodyHatClip\}\s+alt=""/);
    expect(characterSource).not.toContain("centerX - 125");
  });

  test("Appearance exposes mode, body, ink, mood, accessory color, and semantic previews", () => {
    expect(settingsSource).toContain('title={quokkaCompanionEnabled ? "Companion on" : "Companion off"}');
    expect(settingsSource).toContain('aria-label="Quokka body color"');
    expect(settingsSource).toContain('aria-label="Quokka line color"');
    expect(settingsSource).toContain('aria-label="Quokka idle mood and pose"');
    expect(settingsSource).toContain('aria-label="Quokka accessory"');
    expect(settingsSource).toContain('aria-label="Quokka accessory color hue"');
    expect(settingsSource).toContain('aria-label="Automatic quokka expressions"');
  });

  test("personal idle placements use the chosen mood while empty states retain semantic poses", () => {
    expect(chatSource).toContain('className="chat-endmark" personalIdle');
    expect(chatSource).toContain("accessorized={pristineChat}");
    expect(chatSource).toContain("personalIdle={pristineChat}");
    expect(paneSource).toContain('className="be-quokka" accessorized');
  });

  test("bucket-hat angles expose one visible front brim without a rear arc across the face", () => {
    for (const ink of [bucketHatFrontInk, bucketHatThreeQuarterInk, bucketHatSideInk]) {
      expect(ink.match(/<path /g)).toHaveLength(2);
      expect(ink).not.toContain('stroke-width="5"');
    }

    expect(bucketHatFrontInk).toContain("M191 82q65 28 130 0");
    expect(bucketHatFrontInk).not.toContain("q66-12 132 0");
    expect(bucketHatThreeQuarterInk).toContain("M194 82q66 24 133 4");
    expect(bucketHatSideInk).toContain("M219 81q60 24 119 5");
  });
});
