import { describe, expect, test } from "bun:test";

import { vaultChoiceLabel } from "./vaultActivation";

describe("vault activation primary action", () => {
  test("names the exact next action instead of a generic folder choice", () => {
    expect(vaultChoiceLabel("create")).toBe("Choose an empty folder");
    expect(vaultChoiceLabel("open")).toBe("Choose an existing folder");
    expect(vaultChoiceLabel("practice")).toBe("Create a practice vault");
    expect(vaultChoiceLabel("current")).toBe("Use this vault");
  });
});
