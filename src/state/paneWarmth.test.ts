import { describe, expect, test } from "bun:test";

import type { Tab } from "../types";
import { nextWarmSurfaceIds } from "./paneWarmth";

const chat = (id: string): Tab => ({ id, surfaceKind: "chat", chatSlug: id });
const note = (id: string): Tab => ({ id, surfaceKind: "note", noteId: id });
const browser = (id: string): Tab => ({ id, surfaceKind: "browser" });

describe("warm pane surfaces", () => {
  test("retains recent heavy surfaces but never ordinary note tabs", () => {
    const tabs = [chat("a"), note("n"), chat("b")];
    expect(nextWarmSurfaceIds([], tabs[0]!, tabs)).toEqual(["a"]);
    expect(nextWarmSurfaceIds(["a"], tabs[1]!, tabs)).toEqual(["a"]);
    expect(nextWarmSurfaceIds(["a"], tabs[2]!, tabs)).toEqual(["b", "a"]);
  });

  test("bounds idle surfaces and prunes closed tabs", () => {
    const tabs = [chat("b"), chat("c"), chat("d"), chat("e")];
    expect(nextWarmSurfaceIds(["d", "c", "a"], tabs[3]!, tabs)).toEqual(["e", "d", "c"]);
  });

  test("keeps an inactive private browser mounted without making it durable", () => {
    const tabs = [browser("web"), note("n")];
    expect(nextWarmSurfaceIds([], tabs[0]!, tabs)).toEqual(["web"]);
    expect(nextWarmSurfaceIds(["web"], tabs[1]!, tabs)).toEqual(["web"]);
  });

  test("keeps every open private-browser session alive while bounding other heavy surfaces", () => {
    const tabs = [browser("web-a"), chat("chat-a"), browser("web-b"), browser("web-c"), browser("web-d")];
    expect(nextWarmSurfaceIds(["web-c", "web-b", "chat-a", "web-a"], tabs[4]!, tabs)).toEqual([
      "web-d",
      "web-c",
      "web-b",
      "web-a",
      "chat-a",
    ]);
  });
});
