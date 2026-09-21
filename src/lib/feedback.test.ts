import { expect, test } from "bun:test";

import { feedbackUrl, ROTLI_REPO_URL } from "./feedback";

const bodyOf = (url: string) => new URL(url).searchParams.get("body") ?? "";

test("feedback opens a new issue on the public repository", () => {
  const url = feedbackUrl("1.3.0", "mac");
  expect(url.startsWith(`${ROTLI_REPO_URL}/issues/new?`)).toBe(true);
  expect(new URL(url).searchParams.get("labels")).toBe("feedback");
});

test("the prefilled body carries the version and the OS family, and nothing else", () => {
  const body = bodyOf(feedbackUrl("1.3.0", "mac"));
  const visible = body.replace(/<!--[\s\S]*?-->/g, "").trim();
  expect(visible).toBe("---\nRotli 1.3.0 · macOS");
  // a public issue: no path, no home folder, no file, no address
  expect(/[/\\~@]|\.md\b/.test(visible)).toBe(false);
});

test("Rotli Web has no bundle version and says so", () => {
  expect(bodyOf(feedbackUrl(null, "linux"))).toContain("Rotli Web · Linux");
});
