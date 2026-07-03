import { describe, expect, test } from "bun:test";
import { brainLocationLabel, noteLocationLabel } from "./noteLocation";

describe("brainLocationLabel", () => {
  test("wiki area → title-cased area", () => {
    expect(brainLocationLabel("wiki/projects")).toBe("Projects");
    expect(brainLocationLabel("wiki/projects/rotli")).toBe("Projects › Rotli");
    expect(brainLocationLabel("wiki")).toBe("Brain");
  });
  test("staging + board → Captures", () => {
    expect(brainLocationLabel("wiki/_inbox")).toBe("Captures");
    expect(brainLocationLabel("Board")).toBe("Captures");
  });
  test("storage keeps its path", () => {
    expect(brainLocationLabel("Storage/Images")).toBe("Storage › Images");
    expect(brainLocationLabel("Storage")).toBe("Storage");
  });
  test("sinks + inbox + fallback", () => {
    expect(brainLocationLabel("Archive")).toBe("Archive");
    expect(brainLocationLabel("Trash")).toBe("Trash");
    expect(brainLocationLabel("")).toBe("Inbox");
    expect(brainLocationLabel("Inbox")).toBe("Inbox");
    expect(brainLocationLabel("Custom Folder")).toBe("Custom Folder");
  });
  test("linked library (vault) path", () => {
    expect(brainLocationLabel("vault:")).toBe("Linked library");
    expect(brainLocationLabel("vault:wiki/people")).toBe("Library › People");
  });
});

describe("noteLocationLabel", () => {
  test("prefixes ★ Main when in Main", () => {
    expect(noteLocationLabel("wiki/projects", true)).toBe("★ Main · Projects");
    expect(noteLocationLabel("wiki/projects", false)).toBe("Projects");
  });
});
