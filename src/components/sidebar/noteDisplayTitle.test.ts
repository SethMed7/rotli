import { describe, expect, test } from "bun:test";

import { noteDisplayTitle } from "./noteDisplayTitle";

describe("noteDisplayTitle", () => {
  test("removes an exact parent-folder prefix separated by a dash", () => {
    expect(noteDisplayTitle("Myela AI — Strategy (master)", "Myela AI")).toBe("Strategy (master)");
    expect(noteDisplayTitle("myela ai - Sources", "Myela AI")).toBe("Sources");
  });

  test("supports the other quiet title separators without consuming the remainder", () => {
    expect(noteDisplayTitle("Payments: Unified Auth", "Payments")).toBe("Unified Auth");
    expect(noteDisplayTitle("Payments – Agent Portal", "Payments")).toBe("Agent Portal");
  });

  test("leaves unrelated and incomplete titles alone", () => {
    expect(noteDisplayTitle("Strategy for Myela AI", "Myela AI")).toBe("Strategy for Myela AI");
    expect(noteDisplayTitle("Myela AI", "Myela AI")).toBe("Myela AI");
    expect(noteDisplayTitle("Myela AI — ", "Myela AI")).toBe("Myela AI —");
  });
});
