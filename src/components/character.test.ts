import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const characterSource = readFileSync(new URL("character.tsx", import.meta.url), "utf8");
const artSource = readFileSync(new URL("characterArt.ts", import.meta.url), "utf8");
const paneSource = readFileSync(new URL("paneEmptyState.tsx", import.meta.url), "utf8");
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
    expect(characterSource).toContain("poseAccessoryArt(accessoryArtSet, resolvedName)");
    // glasses carry the hue as accents painted over their ink frames
    expect(artSource).toContain("colorOverInk: true");
    expect(characterSource).toContain("ACCESSORY_COLOR_INSET");
    expect(characterSource).toContain('resolvedAccessory === "bucket-hat"');
    expect(characterSource).toContain("BUCKET_HAT_OCCLUSION_EDGE");
    expect(characterSource).toContain("bucketHatBodyClip(accessoryPlacement, resolvedName)");
    expect(characterSource).toContain("...maskStyle(layered.body), ...bodyHatClip");
    expect(characterSource).toMatch(/style=\{bodyHatClip\}\s+alt=""/);
    expect(characterSource).not.toContain("centerX - 125");
  });

  test("the character always renders: no companion switch, no chosen idle mood", () => {
    expect(characterSource).not.toContain("quokkaCompanionEnabled");
    expect(characterSource).not.toContain("personalIdle");
    // the empty pane's scene no longer stages a quokka
    expect(paneSource).not.toContain("<Character");
  });

  test("small ambient characters use one crisp semantic line presentation", () => {
    expect(characterSource).toContain('appearance?: "personalized" | "quiet-line"');
    expect(characterSource).toContain('quietLine ? "line"');
    expect(characterSource).toContain('quietLine ? "none"');
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
