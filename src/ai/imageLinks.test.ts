import { describe, expect, test } from "bun:test";

import { markdownImageSource, normalizeGeneratedImageLinks, qualifiedArtifactId } from "./imageLinks";

describe("generated image links", () => {
  const path = "storage/chats/testing-artifacts/img-01abc.png";

  test("uses the renderer's explicit storage source", () => {
    expect(markdownImageSource(path)).toBe("storage:chats/testing-artifacts/img-01abc.png");
  });

  test("qualifies a generated artifact for a non-default vault", () => {
    expect(qualifiedArtifactId("default", path)).toBe(path);
    expect(qualifiedArtifactId("work", path)).toBe(`work:${path}`);
  });

  test("repairs a matching generated basename without touching unrelated links", () => {
    const body = [
      "![Generated](img-01abc.png)",
      "![Other](other.png)",
      "![Remote](https://example.com/img-01abc.png)",
    ].join("\n");
    expect(normalizeGeneratedImageLinks(body, [path])).toBe(
      [
        "![Generated](storage:chats/testing-artifacts/img-01abc.png)",
        "![Other](other.png)",
        "![Remote](https://example.com/img-01abc.png)",
      ].join("\n"),
    );
  });
});
