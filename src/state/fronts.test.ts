import { afterEach, expect, test } from "bun:test";

import { DEFAULT_FRONTS } from "../lib/sidebarFronts";
import { enforceFronts, frontOn, landingFront, useFronts } from "./fronts";
import { useUiStore } from "./ui";

afterEach(() => {
  useFronts.setState({ prefs: { ...DEFAULT_FRONTS, off: [] } });
  useUiStore.setState({ sidebarMode: "notes", sidebarView: "home" });
});

test("a vault opens on the home front: Notes unless another is chosen", () => {
  expect(landingFront()).toEqual({ sidebarMode: "notes", sidebarView: "home" });
  useFronts.getState().setHome("chat");
  expect(landingFront()).toEqual({ sidebarMode: "notes", sidebarView: "chat" });
});

test("a front that's off steps the sidebar to the home front, and the last one can't go off", () => {
  const stop = enforceFronts();
  useUiStore.setState({ sidebarMode: "notes", sidebarView: "chat" });
  useFronts.getState().setFront("chat", false);
  expect(frontOn("chat")).toBe(false);
  expect(useUiStore.getState().sidebarView).toBe("home");
  // landing on it anyway (a chat tab focused) steps straight back
  useUiStore.setState({ sidebarView: "chat" });
  expect(useUiStore.getState().sidebarView).toBe("home");
  useFronts.getState().setFront("breve", false);
  useFronts.getState().setFront("notes", false);
  expect(frontOn("notes")).toBe(true);
  stop();
});
