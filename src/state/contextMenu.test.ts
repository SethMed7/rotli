import { describe, expect, test } from "bun:test";
import { menuUsesCheckGutter, type MenuSpec } from "./contextMenu";

describe("context menu alignment", () => {
  test("plain action and drill menus do not reserve an empty checkmark indent", () => {
    const items: MenuSpec[] = [
      { kind: "action", label: "Rename", onClick: () => {} },
      { kind: "drill", label: "Move to view", items: [] },
    ];
    expect(menuUsesCheckGutter(items)).toBe(false);
  });

  test("a visible false toggle reserves one shared checkmark gutter", () => {
    const items: MenuSpec[] = [
      { kind: "action", label: "Open", onClick: () => {} },
      { kind: "action", label: "Pin", checked: false, onClick: () => {} },
      { kind: "drill", label: "Move to view", items: [] },
    ];
    expect(menuUsesCheckGutter(items)).toBe(true);
  });

  test("toggle state inside a drill does not indent the parent menu", () => {
    const items: MenuSpec[] = [
      {
        kind: "drill",
        label: "Move to view",
        items: [{ kind: "action", label: "Main", checked: true, onClick: () => {} }],
      },
      { kind: "action", label: "Rename", onClick: () => {} },
    ];
    expect(menuUsesCheckGutter(items)).toBe(false);
    expect(menuUsesCheckGutter(items[0]!.kind === "drill" ? items[0]!.items : [])).toBe(true);
  });
});
