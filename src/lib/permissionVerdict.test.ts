import { expect, test } from "bun:test";

import { permissionVerdict } from "./permissionVerdict";

test("each character is one reader's answer: body edit, on-device, locked, secure", () => {
  expect(permissionVerdict([])).toBe("pu00");
  expect(permissionVerdict(["created_by: chat"])).toBe("au00");
  expect(permissionVerdict(["ai_edit: false", "secure: true", "local_ai_allowed: true"])).toBe("rt01");
  expect(permissionVerdict(["locked: yes", "local_ai_allowed: no"])).toBe("lf10");
});
