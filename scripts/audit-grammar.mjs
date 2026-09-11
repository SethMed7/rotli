// Grammar render audit over the browser twin. Read-only against a local stable
// preview: seeds the synthetic Welcome folder in Main, opens the lessons
// that exercise tasks, results, choices, toggles, raw code, and tables; types
// every documented control expansion into the welcome note at a clean line
// start; clicks the rendered controls; and reads the Markdown source back via
// Aa → Raw markdown after each step so the portable source can be compared
// with SYNTAX.md. It also proves the stable
// build's Mermaid workspace offers View and Code only. Never attaches to a
// profile or native window; only synthetic data is reachable.
//   bun scripts/audit-grammar.mjs http://127.0.0.1:1431
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:1431");
if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
  throw new Error("Local browser twin only");
const output = join(import.meta.dir, "../_review/grammar-audit");
await mkdir(output, { recursive: true });
const report = [];
const log = (line) => {
  report.push(line);
  console.log(line);
};

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin.origin || url.protocol === "data:" ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(origin.origin);
  expect(await page.evaluate(() => "__TAURI_INTERNALS__" in window)).toBe(false);
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
  const shot = async (name) => {
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(output, `${name}.png`), animations: "disabled", caret: "hide" });
  };
  const editor = () => page.locator(".cm-content").last();

  // 1. The synthetic Welcome notes, seeded into Main and rendered from the left menu.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Open welcome folder", exact: true }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Welcome" });
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
  const lessons = page.locator(".main-tree button[data-main-id][data-note-id]", {
    hasText:
      /^(Welcome to Rotli|Writing and formatting|Tasks and progress|Choices and toggles|Tables and code|Links and finding|Main and named views|Files and attachments|AI and privacy|Your launch checklist)$/,
  });
  await expect(lessons).toHaveCount(10);
  const titles = await lessons.allTextContents();
  for (const [index, text] of titles.entries()) {
    if (!/Writing|Tasks|Choices|Tables/.test(text)) continue;
    await lessons.nth(index).click();
    await expect(page.getByRole("tab", { selected: true })).toContainText(text.trim());
    await shot(
      `lesson-${text
        .replace(/^.*— /, "")
        .replace(/[^a-z]+/gi, "-")
        .toLowerCase()}`,
    );
  }
  log("lessons rendered: writing, tasks, choices, tables");

  // 2. Every documented expansion, typed at a clean line start into the welcome
  //    note (an ordinary note; Aa → Raw markdown exposes the real source for readback).
  await lessons.first().click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await expect(editor()).toBeVisible();
  const rawToggle = async (mode) => {
    await page.getByRole("button", { name: "Aa", exact: true }).click();
    await page.getByRole("dialog", { name: "Typography" }).getByRole("button", { name: mode }).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  };
  const source = async () => {
    await rawToggle("Raw markdown");
    const text = await editor().evaluate((el) =>
      Array.from(el.querySelectorAll(".cm-line"))
        .map((l) => l.textContent)
        .join("\n"),
    );
    await rawToggle("Beautified");
    return text;
  };
  await editor().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type("# Grammar probe", { delay: 8 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const probes = [
    ["[] ", "Open task", "- [ ] Open task"],
    ["[/] ", "In progress task", "- [/] In progress task"],
    ["[x] ", "Done task", "- [x] Done task"],
    ["[][] ", "Pass or fail result", "- [ ][ ] Pass or fail result"],
    ["[True][False] ", "Labeled result", "- [True][False] Labeled result"],
    [
      "[True:green][Draw:yellow][False:red] ",
      "Colored result",
      "- [True:green][Draw:yellow][False:red] Colored result",
    ],
    ["[Yes:#E3B341][No:purple] ", "Hex and purple", "- [Yes:#E3B341][No:purple] Hex and purple"],
    ["[#] ", "Single choice", "- [#] Single choice"],
    ["[##?] ", "Multi prompt", "- [##?] Multi prompt"],
    ["[##] ", "Multi option", "- [##] Multi option"],
    ["[|] ", "Compact switch", "- [|x] Compact switch"],
    ["[True|False] ", "Labeled switch", "- [True|x False] Labeled switch"],
    ["[:blue|:green] ", "Color-only switch", "- [:blue|x :green] Color-only switch"],
  ];
  for (const [trigger, text, expected] of probes) {
    await page.keyboard.type(trigger, { delay: 8 });
    await page.keyboard.type(text, { delay: 8 });
    const lines = (await source()).split("\n").filter((l) => l !== "");
    const line = lines.at(-1);
    log(
      `${line === expected ? "ok  " : "DIFF"} typed ${JSON.stringify(trigger + text)} -> ${JSON.stringify(line)}${line === expected ? "" : ` (expected ${JSON.stringify(expected)})`}`,
    );
    await editor().click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("Inline `[#]` and `- [ ]` stay literal, `code` has no chip.", { delay: 8 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/table", { delay: 20 });
  await page.waitForTimeout(300);
  await shot("probe-slash-menu");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  await shot("probe-rendered");
  await writeFile(join(output, "probe-source-after-typing.md"), await source());

  // 3. Click the rendered controls and read the source back.
  const clickAndRead = async (label, locator) => {
    const before = (await source()).split("\n");
    await locator.click();
    await page.waitForTimeout(150);
    const after = (await source()).split("\n");
    const changed = after.filter((l, i) => l !== before[i]);
    log(
      `click ${label}: ${changed.length ? changed.map((l) => JSON.stringify(l)).join(" | ") : "no source change"}`,
    );
  };
  const row = (text) => editor().locator(".cm-line", { hasText: text });
  await clickAndRead("open task box", row("Open task").getByRole("checkbox").first());
  await clickAndRead("labeled result False", row("Labeled result").getByRole("button", { name: "False" }));
  await clickAndRead("colored result Draw", row("Colored result").getByRole("button", { name: "Draw" }));
  await clickAndRead("pass/fail right X", row("Pass or fail result").getByRole("button").nth(1));
  await clickAndRead("single choice", row("Single choice").getByRole("radio").first());
  await clickAndRead("multi option", row("Multi option").getByRole("checkbox").first());
  await clickAndRead("compact switch", row("Compact switch").getByRole("switch").first());
  await shot("probe-after-clicks");
  await writeFile(join(output, "probe-source-after-clicks.md"), await source());

  // 4. Stable build: the Mermaid workspace offers View and Code, never Visual.
  await editor().click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("```mermaid", { delay: 8 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("flowchart LR", { delay: 8 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("A[Idea] --> B[Note]", { delay: 8 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("```", { delay: 8 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Done.", { delay: 8 });
  await page.waitForTimeout(1200);
  const card = page.locator(".rotli-render-block", { has: page.locator(".rotli-mermaid-inline-stage") });
  const diagram = card.locator(".rotli-mermaid-inline-stage svg").first();
  await expect(diagram).toBeVisible({ timeout: 10000 });
  await shot("probe-mermaid-rendered");
  await card.locator(".rotli-render-mermaid-trigger, .rotli-mermaid-inline-stage").first().click();
  const dialog = page.getByRole("dialog");
  if (
    await dialog.waitFor({ state: "visible", timeout: 3000 }).then(
      () => true,
      () => false,
    )
  ) {
    const modes = await dialog
      .getByRole("button")
      .evaluateAll((bs) => bs.map((b) => b.textContent?.trim()).filter(Boolean));
    log(`mermaid workspace buttons: ${modes.join(" · ")}`);
    log(
      modes.includes("Visual")
        ? "DIFF Visual mode is exposed on this build"
        : "ok   Visual mode absent (View/Code only)",
    );
    await shot("probe-mermaid-workspace");
    await page.keyboard.press("Escape");
  } else {
    log(
      "mermaid workspace did not open from the rendered diagram (click path differs); rendering itself confirmed",
    );
  }
  if (pageErrors.length) log(`page errors: ${pageErrors.join(" || ")}`);
  await writeFile(
    join(output, "report.md"),
    `# Grammar audit — ${new Date().toISOString()}\n\n${report.map((l) => `- ${l}`).join("\n")}\n`,
  );
  await context.close();
} finally {
  await browser.close();
}
