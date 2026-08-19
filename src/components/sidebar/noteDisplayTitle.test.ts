import { describe, expect, test } from "bun:test";

import { noteDisplayTitle } from "./noteDisplayTitle";

describe("noteDisplayTitle", () => {
  test("removes an exact parent-folder prefix separated by a dash", () => {
    expect(noteDisplayTitle("Northstar AI — Strategy (master)", "Northstar AI")).toBe("Strategy (master)");
    expect(noteDisplayTitle("northstar ai - Sources", "Northstar AI")).toBe("Sources");
  });

  test("supports the other quiet title separators without consuming the remainder", () => {
    expect(noteDisplayTitle("Payments: Unified Auth", "Payments")).toBe("Unified Auth");
    expect(noteDisplayTitle("Payments – Agent Portal", "Payments")).toBe("Agent Portal");
  });

  test("leaves unrelated and incomplete titles alone", () => {
    expect(noteDisplayTitle("Strategy for Northstar AI", "Northstar AI")).toBe("Strategy for Northstar AI");
    expect(noteDisplayTitle("Northstar AI", "Northstar AI")).toBe("Northstar AI");
    expect(noteDisplayTitle("Northstar AI — ", "Northstar AI")).toBe("Northstar AI —");
  });
});
