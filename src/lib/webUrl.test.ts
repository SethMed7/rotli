import { describe, expect, test } from "bun:test";

import { normalizedWebsite } from "./webUrl";

describe("normalizedWebsite", () => {
  test("accepts bare domains by assuming https", () => {
    expect(normalizedWebsite("bun.sh")).toBe("https://bun.sh/");
  });
  test("keeps explicit http/https URLs", () => {
    expect(normalizedWebsite("http://example.com/x")).toBe("http://example.com/x");
  });
  test("rejects empty, non-web schemes, and junk", () => {
    expect(normalizedWebsite("")).toBeNull();
    expect(normalizedWebsite("   ")).toBeNull();
    expect(normalizedWebsite("ftp://example.com")).toBeNull();
    expect(normalizedWebsite("javascript:alert(1)")).toBeNull();
    expect(normalizedWebsite("not a url at all")).toBeNull();
  });
});
