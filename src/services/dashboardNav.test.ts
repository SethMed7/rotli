import { beforeEach, expect, test } from "bun:test";

import { useUiStore } from "../state/ui";
import { openModelUsage } from "./dashboardNav";

beforeEach(() => {
  useUiStore.setState({ contentView: "panes", dashboardSection: "rotli", settingsOpen: true });
});

test("Model usage opens the dashboard's models lens and closes Settings", () => {
  openModelUsage();
  const ui = useUiStore.getState();
  expect(ui.contentView).toBe("dashboard");
  expect(ui.dashboardSection).toBe("models");
  expect(ui.settingsOpen).toBe(false);
  expect(ui.sidebarMode).toBe("notes");
});
