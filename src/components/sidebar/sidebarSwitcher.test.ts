import { describe, expect, test } from "bun:test";

import { sidebarFrontBody, sidebarFrontSelection } from "./sidebarSwitcher";

describe("sidebar front selection", () => {
  test("the dashboard owns selection instead of leaving Home or Chat active", () => {
    expect(sidebarFrontSelection("home", "dashboard")).toBeNull();
    expect(sidebarFrontSelection("chat", "dashboard")).toBeNull();
  });

  test("ordinary content keeps its current sidebar front selected", () => {
    expect(sidebarFrontSelection("home", "panes")).toBe("home");
    expect(sidebarFrontSelection("chat", "allChats")).toBe("chat");
  });

  test("the visible overview card follows the dashboard lens", () => {
    expect(sidebarFrontBody("chat", "dashboard", "rotli")).toBe("home");
    expect(sidebarFrontBody("home", "dashboard", "models")).toBe("chat");
    expect(sidebarFrontBody("chat", "panes", "rotli")).toBe("chat");
  });
});
