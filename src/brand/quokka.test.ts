import { describe, expect, test } from "bun:test";

import {
  DEFAULT_QUOKKA_ACCESSORY_HUE,
  DEFAULT_QUOKKA_CUSTOM_HUE,
  QUOKKA_ACCESSORIES,
  QUOKKA_POSES,
  normalizeQuokkaAccessoryHue,
  normalizeQuokkaCustomHue,
  quokkaAccessoryColor,
  quokkaAccessoryPlacement,
  quokkaCustomColor,
  quokkaFill,
  quokkaHueFromLegacyColor,
} from "./quokka";

describe("quokka appearance", () => {
  test("normalizes hue values and migrates the retired native color well", () => {
    expect(normalizeQuokkaCustomHue(212.6)).toBe(213);
    expect(normalizeQuokkaCustomHue(400)).toBe(DEFAULT_QUOKKA_CUSTOM_HUE);
    expect(normalizeQuokkaCustomHue(null)).toBe(DEFAULT_QUOKKA_CUSTOM_HUE);
    expect(normalizeQuokkaAccessoryHue(92.7)).toBe(93);
    expect(normalizeQuokkaAccessoryHue(-1)).toBe(DEFAULT_QUOKKA_ACCESSORY_HUE);
    expect(quokkaHueFromLegacyColor("#4a90e2")).toBe(212);
    expect(quokkaHueFromLegacyColor("red")).toBe(DEFAULT_QUOKKA_CUSTOM_HUE);
  });

  test("keeps line art unfilled and resolves named or custom bodies", () => {
    expect(quokkaFill("line")).toBeNull();
    expect(quokkaFill("green")).toBe("#6FA68B");
    expect(quokkaFill("custom")).toBe("var(--quokka-custom-color)");
  });

  test("resolves each custom hue at the character that owns it", () => {
    expect(quokkaCustomColor(213)).toBe("oklch(68% 0.12 213)");
    expect(quokkaAccessoryColor(38)).toBe("oklch(70% 0.15 38)");
    expect(quokkaAccessoryColor(210)).toBe("oklch(70% 0.15 210)");
  });

  test("anchors worn accessories to the selected pose instead of the neutral drawing", () => {
    const neutralGlasses = quokkaAccessoryPlacement("base", "glasses");
    const thoughtfulGlasses = quokkaAccessoryPlacement("thoughtful", "glasses");
    const attentiveGlasses = quokkaAccessoryPlacement("listening", "glasses");
    const walkingGoggles = quokkaAccessoryPlacement("walking", "goggles");

    expect(thoughtfulGlasses).not.toEqual(neutralGlasses);
    expect(attentiveGlasses.translateX).toBeGreaterThan(neutralGlasses.translateX);
    expect(walkingGoggles.scaleX).toBeLessThan(walkingGoggles.scaleY);

    const attentiveHat = quokkaAccessoryPlacement("listening", "bucket-hat");
    expect(attentiveHat.scaleX).toBeLessThan(attentiveGlasses.scaleX);
    expect(attentiveHat.translateY).toBeLessThan(20);

    for (const pose of ["thoughtful", "walking", "listening", "attention"] as const) {
      const bucketHat = quokkaAccessoryPlacement(pose, "bucket-hat");
      expect(bucketHat.translateY).toBeGreaterThanOrEqual(-8);
      expect(bucketHat.translateY).toBeLessThanOrEqual(3);
      expect(bucketHat.scaleY).toBeGreaterThan(0.7);
      expect(bucketHat.scaleY).toBeLessThan(0.84);
    }

    expect(quokkaAccessoryPlacement("thoughtful", "bucket-hat").rotate).toBeLessThan(-6);
    expect(quokkaAccessoryPlacement("listening", "bucket-hat").rotate).toBeLessThan(-2);

    for (const pose of QUOKKA_POSES) {
      for (const accessory of QUOKKA_ACCESSORIES) {
        const placement = quokkaAccessoryPlacement(pose, accessory);
        expect(Number.isFinite(placement.translateX)).toBeTrue();
        expect(Number.isFinite(placement.translateY)).toBeTrue();
        expect(placement.scaleX).toBeGreaterThan(0.5);
        expect(placement.scaleY).toBeGreaterThan(0.5);
      }
    }
  });

  test("keeps the retired scarf out of the accessory catalog", () => {
    expect(QUOKKA_ACCESSORIES).toEqual(["none", "glasses", "bucket-hat", "goggles"]);
  });
});
