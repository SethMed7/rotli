import { describe, expect, test } from "bun:test";

import {
  boardCanvasLook,
  boardRepaint,
  durableBoardBackground,
  isUnchosenBoardBackground,
} from "./boardBackground";

// 2026-09-27: a board's canvas follows the Rotli theme unless the person chose
// its background; Settings can instead keep every unchosen board white.
describe("board background", () => {
  test("no color, Excalidraw's default white, and transparent mean not chosen", () => {
    for (const value of [undefined, "", "#ffffff", "#FFFFFF", "#fff", "transparent", " #ffffff "]) {
      expect(isUnchosenBoardBackground(value)).toBe(true);
    }
    for (const value of ["#f5e6c8", "#1e1e1e", "rgb(10, 20, 30)"]) {
      expect(isUnchosenBoardBackground(value)).toBe(false);
    }
  });

  test("an unchosen board matches the theme: transparent over the theme ground, in its mode", () => {
    expect(boardCanvasLook("theme", undefined, false)).toEqual({ theme: "light", background: "transparent" });
    expect(boardCanvasLook("theme", "#ffffff", true)).toEqual({ theme: "dark", background: "transparent" });
  });

  test("with the White setting an unchosen board stays light and white in every theme", () => {
    expect(boardCanvasLook("white", undefined, true)).toEqual({ theme: "light", background: "#ffffff" });
    expect(boardCanvasLook("white", "transparent", false)).toEqual({ theme: "light", background: "#ffffff" });
  });

  test("a color the person chose always wins; White keeps even that board light", () => {
    expect(boardCanvasLook("theme", "#f5e6c8", true)).toEqual({ theme: "dark", background: "#f5e6c8" });
    expect(boardCanvasLook("white", "#f5e6c8", true)).toEqual({ theme: "light", background: "#f5e6c8" });
  });

  test("only a chosen color is written to the file", () => {
    expect(durableBoardBackground("transparent")).toBeUndefined();
    expect(durableBoardBackground("#ffffff")).toBeUndefined();
    expect(durableBoardBackground("#f5e6c8")).toBe("#f5e6c8");
  });

  test("an open board repaints only while its color is unchosen", () => {
    expect(boardRepaint("transparent", "#ffffff")).toBe("#ffffff"); // Match → White
    expect(boardRepaint("#ffffff", "transparent")).toBe("transparent"); // White → Match
    expect(boardRepaint("#ffc9c9", "transparent")).toBeNull(); // picked in the canvas: theirs
    expect(boardRepaint("transparent", "transparent")).toBeNull();
    expect(boardRepaint(undefined, "#ffffff")).toBeNull(); // no canvas yet
  });
});
