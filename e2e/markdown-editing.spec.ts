import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

const TABLE_NOTE = `# Table editing

| Model | License |
| ----- | ------- |
| Inkling | Apache 2.0 |
| GLM-5.2 | Open |
`;

const WRAPPED_TABLE_NOTE = `# Wrapped table editing

| Corpay API | Purpose | Auth | Env vars |
| ---------- | ------- | ---- | -------- |
| Cards API | Issue/manage cards | Okta OAuth2 client-credentials | \`CORPAY_CARDS_BASE_URL\`, \`CORPAY_CARDS_TOKEN_URL\`, \`CORPAY_CARDS_CLIENT_ID\`, \`CORPAY_CARDS_CLIENT_SECRET\`, \`CORPAY_CARDS_SCOPE\` |
| Webhooks | Real-time events | Cognito subscribe + HMAC verify | \`CORPAY_WEBHOOK_SIGNATURE_SECRET\`, \`CORPAY_WEBHOOK_API_KEY\`, \`CORPAY_WEBHOOK_API_KEY_HEADER\` |
`;

test("clicking a Markdown table cell edits inside the rendered table", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(TABLE_NOTE);

  const table = page.locator(".rotli-md-table");
  await expect(table).toBeVisible();
  await table.getByRole("cell", { name: "Inkling" }).click();

  const cellEditor = table.getByRole("textbox", { name: "Edit Model row 1" });
  await expect(cellEditor).toBeVisible();
  await expect(table).toBeVisible();
  await expect(page.locator(".rotli-table-rawline")).toHaveCount(0);

  await cellEditor.fill("Inkling 2");
  await cellEditor.press("Tab");
  await expect(table).toContainText("Inkling 2");
  await expect(table.getByRole("textbox", { name: "Edit License row 1" })).toBeFocused();

  await table.getByRole("textbox", { name: "Edit License row 1" }).press("Tab");
  await expect(table.getByRole("textbox", { name: "Edit Model row 2" })).toBeFocused();
  await table.getByRole("textbox", { name: "Edit Model row 2" }).press("Tab");
  await table.getByRole("textbox", { name: "Edit License row 2" }).press("Tab");
  await expect(table.getByRole("textbox", { name: "Edit Model row 3" })).toBeFocused();
  await expect(table.locator("tbody tr")).toHaveCount(3);
});

test("dragging a column boundary resizes the column; double-click resets", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(TABLE_NOTE);

  const table = page.locator(".rotli-md-table");
  await expect(table).toBeVisible();
  const firstHeader = table.locator("th").first();
  const before = await firstHeader.boundingBox();
  if (!before) throw new Error("no header box");

  // press ON the boundary between the two columns and drag 80px right
  await page.mouse.move(before.x + before.width - 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width + 78, before.y + before.height / 2, { steps: 4 });
  await page.mouse.up();

  const after = await firstHeader.boundingBox();
  if (!after) throw new Error("no header box after drag");
  expect(after.width).toBeGreaterThan(before.width + 60);
  // the boundary press resized — it must not have opened the cell editor
  await expect(table.locator(".rotli-md-cell-input")).toHaveCount(0);

  // double-click the boundary → back to auto layout
  await page.mouse.dblclick(after.x + after.width - 2, after.y + after.height / 2);
  const restored = await firstHeader.boundingBox();
  if (!restored) throw new Error("no header box after reset");
  expect(Math.abs(restored.width - before.width)).toBeLessThan(12);
});

test("editing a wrapped table cell preserves the table's shape", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(WRAPPED_TABLE_NOTE);

  const table = page.locator(".rotli-md-table");
  const target = table.getByRole("cell", { name: /CORPAY_CARDS_BASE_URL/ });
  const row = target.locator("xpath=..");
  const beforeTable = await table.boundingBox();
  const beforeCell = await target.boundingBox();
  const beforeRow = await row.boundingBox();
  expect(beforeTable).not.toBeNull();
  expect(beforeCell).not.toBeNull();
  expect(beforeRow).not.toBeNull();

  await target.click();
  const cellEditor = table.getByRole("textbox", { name: "Edit Env vars row 1" });
  await expect(cellEditor).toBeVisible();
  expect(await cellEditor.evaluate((node) => node.tagName)).toBe("TEXTAREA");

  const duringTable = await table.boundingBox();
  const duringCell = await cellEditor.locator("xpath=..").boundingBox();
  const duringRow = await cellEditor.locator("xpath=../..").boundingBox();
  expect(Math.abs((duringTable?.width ?? 0) - (beforeTable?.width ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((duringCell?.width ?? 0) - (beforeCell?.width ?? 0))).toBeLessThanOrEqual(1);
  expect(duringRow?.height ?? 0).toBeGreaterThanOrEqual((beforeRow?.height ?? 0) - 1);
});

test("an exact note-title wikilink opens on an ordinary click", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText("# Link test\n\n[[Pricing decision]]");

  await page.locator(".rotli-wikilink", { hasText: "Pricing decision" }).click();
  await expect(page.locator(".cm-content")).toContainText("Free local forever.");
});

test("a ts code fence renders IDE-grade token colors", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(
    '# Code\n\n```ts\nconst greeting: string = "hello";\n// a comment\nfunction shout(s: string) {\n  return s.toUpperCase();\n}\n```\n',
  );

  // the async highlighter loads the language, then marks land as decorations
  await expect(page.locator(".rotli-tok-kw").first()).toBeVisible(); // const / function / return
  await expect(page.locator(".rotli-tok-str").first()).toContainText('"hello"');
  await expect(page.locator(".rotli-tok-cmt").first()).toContainText("// a comment");
  await expect(page.locator(".rotli-tok-fn").first()).toBeVisible(); // shout / toUpperCase
  // the source is untouched — the fence still carries its exact text
  await expect(editor).toContainText("const greeting");
});

test("raw Markdown uses the Rotli syntax grammar without changing source", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(
    "# Model landscape\n\n- **Inkling** belongs to [[Strategy]]\n\n```mermaid\nflowchart LR\n  A --> B\n```",
  );

  await page.getByRole("button", { name: "Aa" }).click();
  await page
    .getByRole("dialog", { name: "Typography" })
    .getByRole("button", { name: "Raw markdown" })
    .click();

  await expect(page.locator(".cm-editor.rotli-raw-mode")).toBeVisible();
  await expect(page.locator(".rotli-raw-heading")).toContainText("Model landscape");
  await expect(page.locator(".rotli-raw-strong")).toContainText("**Inkling**");
  await expect(page.locator(".rotli-raw-accent")).not.toHaveCount(0);
  await expect(page.locator(".rotli-raw-code-line")).toHaveCount(4);
  await expect(editor).toContainText("flowchart LR");
});

test("bullet outdent works on app-made AND tab-indented (foreign) lists", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();

  // the app's own flow: nest with Tab, come back with Shift-Tab, keep typing
  await page.keyboard.type("- alpha");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("child");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("gamma");
  await expect(editor).toContainText("gamma");

  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");

  // a foreign note indented with TABS (external editors, LLM output): the
  // bullet must render as a bullet and Shift-Tab must outdent it — this was
  // completely dead (raw text, no-op Shift-Tab; the maintainer, 2026-07-28)
  await page.keyboard.insertText("- alpha\n\t- child");
  await expect(page.locator(".rotli-li")).toHaveCount(2); // BOTH lines are bullets
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("!");
  await expect(editor).toContainText("child!");

  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");

  // tasks keep their checkboxes through an outdent
  await page.keyboard.insertText("- [ ] a\n  - [x] b");
  await expect(page.locator(".rotli-check")).toHaveCount(2);
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".rotli-check")).toHaveCount(2);
});

test("bare task states become portable tasks and single checkboxes use the theme accent", async ({
  page,
}) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();

  await page.keyboard.type("[/]");
  await page.keyboard.press("Space");
  await page.keyboard.type("Drafting");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("checkbox", { name: "Not started" })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("[x]");
  await page.keyboard.press("Space");
  await page.keyboard.type("Shipped");

  const doing = page.getByRole("checkbox", { name: "In progress" });
  const done = page.getByRole("checkbox", { name: "Done" });
  await expect(doing).toHaveAttribute("aria-checked", "mixed");
  await expect(done).toHaveAttribute("aria-checked", "true");

  const colors = await done.evaluate((element) => {
    const accentProbe = document.createElement("span");
    accentProbe.style.backgroundColor = "var(--accent)";
    const successProbe = document.createElement("span");
    successProbe.style.backgroundColor = "var(--success)";
    document.body.append(accentProbe, successProbe);
    const result = {
      actual: getComputedStyle(element).backgroundColor,
      accent: getComputedStyle(accentProbe).backgroundColor,
      success: getComputedStyle(successProbe).backgroundColor,
    };
    accentProbe.remove();
    successProbe.remove();
    return result;
  });
  expect(colors.actual).toBe(colors.accent);
  expect(colors.actual).not.toBe(colors.success);
  expect(await done.evaluate((element) => getComputedStyle(element, "::after").content)).toBe("none");

  await done.focus();
  await page.keyboard.press("Space");
  const reopened = page.getByRole("checkbox", { name: "Not started" });
  await expect(reopened).toHaveAttribute("aria-checked", "false");
  await expect(reopened).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("checkbox", { name: "Done" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("checkbox", { name: "Done" })).toBeFocused();

  await page.getByRole("checkbox", { name: "Done" }).click();
  const open = page.getByRole("checkbox", { name: "Not started" });
  await expect(open).toHaveAttribute("aria-checked", "false");
  await open.hover();
  const partial = page.getByRole("button", { name: "Mark task in progress" });
  await expect(partial).toBeVisible();
  await partial.click();
  await expect(page.getByRole("checkbox", { name: "In progress" })).toHaveCount(2);
  await page.getByRole("checkbox", { name: "In progress" }).last().click();
  await expect(page.getByRole("checkbox", { name: "Done" })).toBeVisible();

  await page.getByRole("button", { name: "Aa" }).click();
  await page
    .getByRole("dialog", { name: "Typography" })
    .getByRole("button", { name: "Raw markdown" })
    .click();
  await expect(editor).toContainText("- [/] Drafting");
  await expect(editor).toContainText("- [x] Shipped");
});

test("[][] creates a keyboard-safe pass/fail result with an optional reason", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();

  await page.keyboard.type("[][]");
  await page.keyboard.press("Space");
  await page.keyboard.type("API boots cleanly");

  const no = page.getByRole("button", { name: "No or failed" });
  const yes = page.getByRole("button", { name: "Yes or passed" });
  await expect(no).toHaveAttribute("aria-pressed", "false");
  await expect(yes).toHaveAttribute("aria-pressed", "false");

  const yesBox = await yes.boundingBox();
  const noBox = await no.boundingBox();
  if (!yesBox || !noBox) throw new Error("result controls are not visible");
  expect(yesBox.x).toBeLessThan(noBox.x); // check is left; X is right

  await yes.focus();
  await expect(yes).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(no).toBeFocused();

  await no.click();
  await expect(no).toHaveAttribute("aria-pressed", "true");
  await expect(yes).toHaveAttribute("aria-pressed", "false");
  await expect(yes).toHaveClass(/is-rejected/);
  await expect(page.locator(".rotli-result-text--no")).toContainText("API boots cleanly");
  await expect(page.locator(".rotli-result-text--no")).toHaveCSS("font-weight", "700");
  const noColors = await no.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--failure)";
    const accentProbe = document.createElement("span");
    accentProbe.style.color = "var(--accent)";
    document.body.append(probe, accentProbe);
    const result = {
      actual: getComputedStyle(element).color,
      failure: getComputedStyle(probe).color,
      accent: getComputedStyle(accentProbe).color,
    };
    probe.remove();
    accentProbe.remove();
    return result;
  });
  expect(noColors.actual).toBe(noColors.failure);
  expect(noColors.actual).not.toBe(noColors.accent);

  await page.getByRole("button", { name: "Add a reason for this result" }).click();
  await page.keyboard.type("timed out waiting for health check");
  await expect(page.locator(".rotli-result-reason")).toContainText("timed out waiting for health check");
  await expect(page.getByRole("button", { name: "Add a reason for this result" })).toHaveCount(0);

  await yes.click();
  await expect(no).toHaveAttribute("aria-pressed", "false");
  await expect(yes).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".rotli-result-text--no")).toHaveCount(0);
  await expect(page.locator(".rotli-result-text--yes")).toContainText("API boots cleanly");
  await expect(page.locator(".rotli-result-text--yes")).toHaveCSS("font-weight", "700");
  await expect(page.locator(".rotli-result-reason")).toHaveCSS("font-weight", "400");
  const yesColors = await yes.evaluate((element) => {
    const successProbe = document.createElement("span");
    successProbe.style.backgroundColor = "var(--success)";
    const accentProbe = document.createElement("span");
    accentProbe.style.backgroundColor = "var(--accent)";
    document.body.append(successProbe, accentProbe);
    const result = {
      actual: getComputedStyle(element).backgroundColor,
      success: getComputedStyle(successProbe).backgroundColor,
      accent: getComputedStyle(accentProbe).backgroundColor,
    };
    successProbe.remove();
    accentProbe.remove();
    return result;
  });
  expect(yesColors.actual).toBe(yesColors.success);
  expect(yesColors.actual).not.toBe(yesColors.accent);

  await page.getByRole("button", { name: "Aa" }).click();
  await page
    .getByRole("dialog", { name: "Typography" })
    .getByRole("button", { name: "Raw markdown" })
    .click();
  await expect(editor).toContainText("- [x][ ] API boots cleanly — timed out waiting for health check");
});

test("labeled result buttons preserve source labels and apply semantic or custom colors", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  const editor = page.locator(".cm-content").last();
  await editor.click();

  await page.keyboard.type("[True:green][Draw:#E3B341][False:red]");
  await page.keyboard.press("Space");
  await page.keyboard.type("Release decision");

  const truth = page.getByRole("button", { name: "True" });
  const draw = page.getByRole("button", { name: "Draw" });
  const falsity = page.getByRole("button", { name: "False" });
  await expect(truth).toHaveAttribute("aria-pressed", "false");
  await expect(draw).toHaveAttribute("aria-pressed", "false");
  await expect(falsity).toHaveAttribute("aria-pressed", "false");

  await draw.focus();
  await page.keyboard.press("Space");
  await expect(draw).toHaveAttribute("aria-pressed", "true");
  await expect(draw).toBeFocused();
  await expect(truth).toHaveAttribute("aria-pressed", "false");
  await expect(falsity).toHaveAttribute("aria-pressed", "false");
  await expect(draw).toHaveCSS("background-color", "rgb(227, 179, 65)");

  await falsity.click();
  await expect(draw).toHaveAttribute("aria-pressed", "false");
  await expect(falsity).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Aa" }).click();
  await page
    .getByRole("dialog", { name: "Typography" })
    .getByRole("button", { name: "Raw markdown" })
    .click();
  await expect(editor).toContainText("- [True:green][Draw:#E3B341][x False:red] Release decision");
});

test("hash choices and switches stay interactive while inline code stays literal", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(
    "- [#] Red\n- [#] Blue\n\n- [##] Email\n- [##] SMS\n\n- [|x] Feature flag\n- [True:green|x False:red] Sync\n- [:blue|:green] Color only\n\n`[#]` and `[|]` stay literal",
  );
  await page.locator(".ed-date").click();

  const radios = page.getByRole("radio", { name: "Choose option" });
  await expect(radios).toHaveCount(2);
  await radios.nth(1).click();
  await expect(radios.nth(0)).toHaveAttribute("aria-checked", "false");
  await expect(radios.nth(1)).toHaveAttribute("aria-checked", "true");

  const multis = page.getByRole("checkbox", { name: "Toggle option" });
  await expect(multis).toHaveCount(2);
  await multis.nth(0).click();
  await multis.nth(1).click();
  await expect(multis.nth(0)).toHaveAttribute("aria-checked", "true");
  await expect(multis.nth(1)).toHaveAttribute("aria-checked", "true");

  const compactToggle = page.getByRole("switch", { name: "On or Off" }).first();
  const labeledToggle = page.getByRole("switch", { name: "True or False" });
  await expect(compactToggle).toHaveAttribute("aria-checked", "false");
  await compactToggle.focus();
  await page.keyboard.press("Space");
  await expect(compactToggle).toHaveAttribute("aria-checked", "true");
  await expect(compactToggle).toBeFocused();
  await labeledToggle.click();
  await expect(labeledToggle).toHaveAttribute("aria-checked", "true");

  await expect(page.locator(".rotli-choice")).toHaveCount(4);
  await expect(page.locator(".rotli-toggle")).toHaveCount(3);
  await expect(page.locator(".rotli-choice-line--multi.is-group-first")).toHaveCount(1);
  await expect(page.locator(".rotli-choice-line--multi.is-group-last")).toHaveCount(1);
  const literal = page.locator(".rotli-control-literal", { hasText: "[#]" });
  await expect(literal).toBeVisible();
  await expect(literal).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(literal).toHaveCSS("padding-left", "0px");
  await expect(page.locator(".rotli-code", { hasText: "[|]" })).toBeVisible();

  await page.getByRole("button", { name: "Aa" }).click();
  await page
    .getByRole("dialog", { name: "Typography" })
    .getByRole("button", { name: "Raw markdown" })
    .click();
  await expect(editor).toContainText("- [#x] Blue");
  await expect(editor).toContainText("- [##x] Email");
  await expect(editor).toContainText("- [##x] SMS");
  await expect(editor).toContainText("- [x|] Feature flag");
  await expect(editor).toContainText("- [x True:green|False:red] Sync");
  await expect(editor).toContainText("`[#]` and `[|]` stay literal");
});

test("() creates a tab-navigable Markdown multiple-choice group", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();

  await page.keyboard.type("()");
  await page.keyboard.press("Space");
  await page.keyboard.type("Red");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Blue");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Green");

  const choices = page.locator(".rotli-choice");
  await expect(choices).toHaveCount(3);
  await choices.nth(0).focus();
  await page.keyboard.press("Tab");
  await expect(choices.nth(1)).toBeFocused();

  await choices.nth(1).click();
  await expect(choices.nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(choices.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(choices.nth(2)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".rotli-choice-text--selected")).toContainText("Blue");
  await expect(page.locator(".rotli-choice-text--selected")).toHaveCSS("font-weight", "700");

  await choices.nth(2).click();
  await expect(choices.nth(1)).toHaveAttribute("aria-pressed", "false");
  await expect(choices.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".rotli-choice-text--selected")).toContainText("Green");

  await page.getByRole("button", { name: "Aa" }).click();
  await page
    .getByRole("dialog", { name: "Typography" })
    .getByRole("button", { name: "Raw markdown" })
    .click();
  const rawLines = editor.locator(".cm-line");
  await expect(rawLines).toHaveCount(3);
  await expect(rawLines.nth(0)).toHaveText("- ( ) Red");
  await expect(rawLines.nth(1)).toHaveText("- ( ) Blue");
  await expect(rawLines.nth(2)).toHaveText("- (x) Green");
});

test("slash commands work inside a numbered list item", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText("1. /heading 2");

  const menu = page.getByRole("menu", { name: "Insert block" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: /Heading 2/ }).click();

  await page.getByRole("button", { name: "Aa" }).click();
  await page
    .getByRole("dialog", { name: "Typography" })
    .getByRole("button", { name: "Raw markdown" })
    .click();
  await expect(editor).toContainText("1. ## ");
});

test("select all keeps images rendered and selected", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(
    "# Selection\n\nBefore\n\n![](storage:selection.png)\n\n- ![](storage:list-selection.png)\n\nAfter",
  );

  await expect(page.locator(".rotli-img")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+A");
  await expect(page.locator(".rotli-img.sel")).toHaveCount(2);
});

test("arrowing into an image selects the rendered image", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText("![](storage:arrow-selection.png)\nAfter");

  await expect(page.locator(".rotli-img")).toHaveCount(1);
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".rotli-img.sel")).toHaveCount(1);
});

test("double-clicking a rendered image keeps it selected instead of exposing source", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText("![](storage:double-click-selection.png)\nAfter");

  const image = page.locator(".rotli-img");
  await expect(image).toHaveCount(1);
  await image.dblclick();
  await expect(page.locator(".rotli-img.sel")).toHaveCount(1);
  await expect(editor).not.toContainText("![](storage:double-click-selection.png)");
});

test("a secondary click on a result control does not answer it", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.type("[][]");
  await page.keyboard.press("Space");
  await page.keyboard.type("Right-click stays neutral");

  const no = page.getByRole("button", { name: "No or failed" });
  const yes = page.getByRole("button", { name: "Yes or passed" });
  await no.click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(no).toHaveAttribute("aria-pressed", "false");
  await expect(yes).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".rotli-result-text--no")).toHaveCount(0);
});

test("a video source renders a playable embed with the image contract", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText("![](storage:clip.mp4)\nAfter");

  const embed = page.locator(".rotli-img");
  await expect(embed).toHaveCount(1);
  await expect(embed.locator("video")).toHaveCount(1);
  await expect(embed.locator("video")).toHaveAttribute("controls", "");
  await expect(embed.locator("img")).toHaveCount(0);
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".rotli-img.sel")).toHaveCount(1);
});

test("a slash command typed in a result's reason lands its block beneath the row", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.type("[][]");
  await page.keyboard.press("Space");
  await page.keyboard.type("API boots");
  const yes = page.getByRole("button", { name: "Yes or passed" });
  await yes.click();
  await page.getByRole("button", { name: "Add a reason for this result" }).click();
  await page.keyboard.type("slowly /table");

  const menu = page.getByRole("menu", { name: "Insert block" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();

  await expect(yes).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".rotli-result-text--yes")).toContainText("API boots");
  await expect(page.locator(".rotli-result-reason")).toContainText("slowly");
  await expect(page.locator(".rotli-result-reason")).not.toContainText("/table");
  await expect(editor.locator("table")).toHaveCount(1);
});

const LONG_TABLE_NOTE = `# Column actions stay put

| Note | Summary | Extra |
| ---- | ------- | ----- |
| One | First row summary | x |
| Two | Second row summary | y |

${Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1} of filler text that makes the note tall enough to scroll.`).join("\n\n")}
`;

test("deleting a column keeps the table in view and shows a resize grip on the boundary", async ({
  page,
}) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(LONG_TABLE_NOTE);
  // the caret now sits at the very end of a tall note. Scroll (not the caret)
  // back to the top — CodeMirror only renders the viewport, so the table is
  // not even in the DOM until then; the stale far-away caret is the point.
  const scroller = page.locator(".cm-scroller").last();
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  const table = page.locator(".rotli-md-table");
  await expect(table).toBeInViewport();
  await expect(table.locator("thead th")).toHaveCount(3);

  // hover a boundary: the visible grip lights on the edge between Note and Summary
  const first = table.locator("thead th").first();
  const box = await first.boundingBox();
  if (!box) throw new Error("no header cell box");
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await expect(page.locator(".rotli-tbl-grip.col.on")).toBeVisible();

  // the column chip → Delete column: the table stays where it was, the caret
  // lands on the table instead of the note's far end
  await table.locator("thead th").nth(2).hover();
  await page.locator(".rotli-tbl-chip.colchip.on").click();
  await page.getByRole("menuitem", { name: "Delete column" }).click();
  await expect(table.locator("thead th")).toHaveCount(2);
  await expect(table).toBeInViewport();
  // the editor may nudge a few pixels to show the caret line; it must not be
  // anywhere near the bottom of the 80-paragraph note
  await expect
    .poll(() =>
      page
        .locator(".cm-scroller")
        .last()
        .evaluate((el) => el.scrollTop),
    )
    .toBeLessThan(200);
});
