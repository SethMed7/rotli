import { describe, expect, test } from "bun:test";

import { CHROME_CANDIDATES, pickChrome } from "../scripts/chrome-pdf";

const none = () => false;
const all = () => true;

describe("headless Chrome resolution", () => {
  test("an explicit override wins over every installed candidate", () => {
    expect(pickChrome(CHROME_CANDIDATES, all, "/opt/my-chromium")).toBe("/opt/my-chromium");
  });

  test("falls back to the first candidate that exists", () => {
    const present = "/usr/bin/chromium";
    expect(pickChrome(CHROME_CANDIDATES, (path) => path === present)).toBe(present);
  });

  test("prefers Chrome when several are installed", () => {
    expect(pickChrome(CHROME_CANDIDATES, all)).toBe(CHROME_CANDIDATES[0]);
  });

  test("returns null when nothing is installed, so the caller can report why", () => {
    expect(pickChrome(CHROME_CANDIDATES, none)).toBeNull();
  });

  test("covers the Linux paths CI and a future Linux build would use", () => {
    expect(CHROME_CANDIDATES).toContain("/usr/bin/google-chrome");
    expect(CHROME_CANDIDATES).toContain("/usr/bin/chromium");
  });
});
