// Resize + fit law (Seth, 2026-08-01: "we want to think about the way
// everything resizes and fits as a whole"). A pane is a BOX: at any window
// size, at any divider position, a surface either fits inside its pane or
// scrolls inside it — it never paints into the pane next door, and its own
// chrome (tab strip, title row, composer) never lands on top of itself.
//
// The reported failure was a small window with two stacked chat panes: the top
// pane's composer escaped its pane and painted across the bottom pane's tab
// strip and title row, so the composer's globe/attach buttons sat on the
// bottom chat's title. One root cause (a surface taller than its pane, with no
// containment and a pane floor below the chrome's own height), two symptoms.
//
// The viewport here is deliberately near the shipped window floor
// (tauri.conf.json: minWidth 720 / minHeight 480) — the smallest geometry a
// user can actually produce.

import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

test.use({ viewport: { width: 900, height: 520 } });

/** Every pane's rect, in DOM order (top pane first for a column split). */
async function paneRects(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".pane")].map((pane) => {
      const r = pane.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
    }),
  );
}

/** Sample the paint: every point in `band` must hit an element that belongs to
 * the pane at `paneIndex` (or the split divider). This catches an intruder that
 * lands ON TOP of the neighbour; it cannot catch one that shows THROUGH a
 * transparent neighbour (hit-testing returns the topmost element either way),
 * which is why the geometric checks below are the load-bearing ones. */
async function foreignPaintAt(
  page: import("@playwright/test").Page,
  paneIndex: number,
  band: { top: number; height: number },
) {
  return page.evaluate(
    ({ paneIndex, band }) => {
      const panes = [...document.querySelectorAll(".pane")];
      const pane = panes[paneIndex];
      if (!pane) throw new Error("no pane at index");
      const rect = pane.getBoundingClientRect();
      const strays: string[] = [];
      for (let y = rect.y + band.top; y < rect.y + band.top + band.height; y += 4) {
        for (let x = rect.x + 6; x < rect.right - 6; x += 24) {
          const hit = document.elementFromPoint(x, y);
          if (!hit) continue;
          if (hit.closest(".divider")) continue;
          const owner = hit.closest(".pane");
          if (owner === pane) continue;
          strays.push(`${hit.className || hit.tagName} @ ${Math.round(x)},${Math.round(y)}`);
        }
      }
      return [...new Set(strays)];
    },
    { paneIndex, band },
  );
}

/** The chrome that must FIT, not scroll: a pane's strip and the fixed rows of
 * whatever surface it holds. Returns the pieces whose box escapes their pane. */
async function escapingChrome(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const CHROME = [".tabstrip", ".chat-head", ".chat-composer", ".ed-head"];
    const out: string[] = [];
    for (const pane of document.querySelectorAll(".pane")) {
      const box = pane.getBoundingClientRect();
      for (const sel of CHROME) {
        for (const el of pane.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.bottom > box.bottom + 1 || r.top < box.top - 1 || r.right > box.right + 1) {
            out.push(`${sel} escapes its pane (pane ${Math.round(box.height)}px tall)`);
          }
        }
      }
    }
    return out;
  });
}

/** Open a chat tab in the focused pane through the sidebar's own New chat row. */
async function openChatPane(page: import("@playwright/test").Page) {
  await gotoApp(page);
  const newChat = page.locator(".sb-chatnew");
  if (!(await newChat.isVisible())) await page.locator(".sb-sec", { hasText: "Chat" }).first().click();
  await newChat.click();
  await expect(page.locator(".chat-surface")).toHaveCount(1);
}

/** Stack two chat panes: a chat tab in the focused pane, then Split down (the
 * titlebar's own control — no ⌘ chords, which the browser twin can't take). */
async function stackTwoChatPanes(page: import("@playwright/test").Page) {
  await openChatPane(page);
  await page.getByRole("button", { name: "Split down — ⌘⇧D" }).click();
  await expect(page.locator(".pane")).toHaveCount(2);
  await expect(page.locator(".chat-surface")).toHaveCount(2);
}

test("stacked chat panes in a small window keep their chrome inside their own pane", async ({ page }) => {
  await stackTwoChatPanes(page);

  // the reported symptom: the top pane's composer painting across the bottom
  // pane's strip + title row. Sample the bottom pane's top 80px — the band the
  // strip and chat title live in.
  expect(await foreignPaintAt(page, 1, { top: 0, height: 80 })).toEqual([]);
  // and the mirror check: nothing from below reaches up into the top pane
  const rects = await paneRects(page);
  const top = rects[0];
  if (!top) throw new Error("no top pane");
  expect(await foreignPaintAt(page, 0, { top: Math.max(top.height - 80, 0), height: 78 })).toEqual([]);

  // the fixed rows themselves fit — the thread is what scrolls, not the chrome
  expect(await escapingChrome(page)).toEqual([]);
});

test("dragging a stack divider to either extreme leaves both panes usable", async ({ page }) => {
  await stackTwoChatPanes(page);

  const divider = page.locator(".divider");
  const box = await divider.boundingBox();
  if (!box) throw new Error("divider has no box");

  // shove it to the very top of the window
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, 0, { steps: 12 });
  await page.mouse.up();

  let rects = await paneRects(page);
  // MIN_PANE_HEIGHT (src/state/panes.ts) — the floor that keeps a pane's own
  // chrome from having to overlap itself
  for (const r of rects) expect(r.height).toBeGreaterThanOrEqual(200);
  expect(await escapingChrome(page)).toEqual([]);
  expect(await foreignPaintAt(page, 1, { top: 0, height: 60 })).toEqual([]);

  // …and to the very bottom
  const box2 = await divider.boundingBox();
  if (!box2) throw new Error("divider has no box");
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2, 520, { steps: 12 });
  await page.mouse.up();

  rects = await paneRects(page);
  for (const r of rects) expect(r.height).toBeGreaterThanOrEqual(200);
  expect(await escapingChrome(page)).toEqual([]);
  expect(await foreignPaintAt(page, 0, { top: 0, height: 60 })).toEqual([]);
});

test("shrinking the window re-fits a lopsided split instead of crushing a pane", async ({ page }) => {
  await stackTwoChatPanes(page);

  // push the divider low, then shrink the window under the two-pane floor
  const box = await page.locator(".divider").boundingBox();
  if (!box) throw new Error("divider has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, 460, { steps: 10 });
  await page.mouse.up();

  await page.setViewportSize({ width: 760, height: 480 });
  // the refit is debounced behind a resize observer
  await expect
    .poll(async () => (await paneRects(page)).every((r) => r.height >= 150), { timeout: 3_000 })
    .toBe(true);
  expect(await escapingChrome(page)).toEqual([]);
});

/** ChatSurface's shipped scaffold (src/components/chatSurface.tsx), as markup.
 * The browser twin renders the chat's "runs in the app" state instead of the
 * live thread — no composer, no header tools — so the reported failure (a
 * composer taller than its pane, spilling onto the pane below) can only be
 * measured by mounting the real classes into a real pane and letting the
 * SHIPPED cascade size them. */
const CHAT_SCAFFOLD = `
  <header class="chat-head">
    <h2 class="chat-title-h">Testing Gemma Four And Every Other Model We Ever Connected</h2>
    <span class="chat-inst">· a long connected memex instance label</span>
    <div class="chat-head-tools">
      <button type="button" class="chat-tool">A</button>
      <button type="button" class="chat-tool">B</button>
    </div>
  </header>
  <main class="chat-main">
    <div class="chat-scroll"><div class="chat-thread"><p>a message</p></div></div>
    <div class="chat-composer">
      <div class="chat-composer-inner">
        <div class="chat-box">
          <textarea class="chat-msg" rows="1" placeholder="Message rotli…"></textarea>
          <div class="chat-box-foot">
            <span class="chat-modelpick">
              <button type="button" class="chat-model-trigger">
                <span class="chat-model-trigger-name">a rather long local model name</span>
                <span class="chat-model-caret">▾</span>
              </button>
            </span>
            <button type="button" class="chat-tool">G</button>
            <button type="button" class="chat-tool">C</button>
            <span class="chat-box-grow"></span>
            <button type="button" class="chat-send">↑</button>
          </div>
        </div>
      </div>
    </div>
  </main>`;

test("a live chat's composer stays inside its own pane in a stacked split", async ({ page }) => {
  await stackTwoChatPanes(page);

  const fit = await page.evaluate((scaffold) => {
    const surface = document.querySelectorAll(".chat-surface")[0];
    const pane = document.querySelectorAll(".pane")[0];
    const neighbour = document.querySelectorAll(".pane")[1];
    if (!surface || !pane || !neighbour) throw new Error("no stacked chat panes");
    surface.innerHTML = scaffold;
    const box = pane.getBoundingClientRect();
    const measure = (sel: string) => {
      const r = surface.querySelector(sel)?.getBoundingClientRect();
      if (!r) throw new Error(`no ${sel}`);
      return r;
    };
    return {
      paneHeight: Math.round(box.height),
      composerBelowPaneBy: Math.round(measure(".chat-composer").bottom - box.bottom),
      composerIntoNeighbourBy: Math.round(
        measure(".chat-composer").bottom - neighbour.getBoundingClientRect().top,
      ),
      headAbovePaneBy: Math.round(box.top - measure(".chat-head").top),
      footRightOfBoxBy: Math.round(measure(".chat-box-foot").right - measure(".chat-box").right),
      sendVisible: Math.round(measure(".chat-send").width),
    };
  }, CHAT_SCAFFOLD);

  // the composer is the pane's floor, not the neighbour's ceiling. (Before the
  // 2026-08-01 fit sweep this overhung by ~75px at the then-160px pane floor —
  // the tab strip and title row of the pane below wore it.)
  expect(fit.composerBelowPaneBy).toBeLessThanOrEqual(0);
  expect(fit.composerIntoNeighbourBy).toBeLessThanOrEqual(0);
  expect(fit.headAbovePaneBy).toBeLessThanOrEqual(0);
  // …and the composer's own row fits its box: Send never gets pushed out by a
  // long model name
  expect(fit.footRightOfBoxBy).toBeLessThanOrEqual(0);
  expect(fit.sendVisible).toBeGreaterThan(20);

  // nothing from the top pane reaches the bottom pane's strip + title band
  expect(await foreignPaintAt(page, 1, { top: 0, height: 80 })).toEqual([]);
});

test("a chat title yields to its header tools instead of sitting under them", async ({ page }) => {
  // CSS-grammar probe. The browser twin renders the chat surface without a
  // connected memex, so the header's tool cluster never mounts — this mirrors
  // ChatSurface's header markup (src/components/chatSurface.tsx) into a real
  // pane so the SHIPPED cascade is what gets measured.
  await openChatPane(page);

  const overlap = await page.evaluate(() => {
    const surface = document.querySelector(".chat-surface");
    if (!surface) throw new Error("no chat surface");
    const head = document.createElement("header");
    head.className = "chat-head";
    head.innerHTML =
      '<h2 class="chat-title-h">Testing Gemma Four And Every Other Model We Have Ever Connected</h2>' +
      '<span class="chat-inst">· a long connected memex instance label</span>' +
      '<div class="chat-head-tools">' +
      '<button type="button" class="chat-tool">A</button>' +
      '<button type="button" class="chat-tool">B</button>' +
      '<button type="button" class="chat-tool">C</button>' +
      "</div>";
    surface.prepend(head);
    const title = head.querySelector(".chat-title-h")!.getBoundingClientRect();
    const tools = head.querySelector(".chat-head-tools")!.getBoundingClientRect();
    const headRect = head.getBoundingClientRect();
    const toolsWidth = tools.width;
    head.remove();
    return {
      titleOverToolsBy: Math.round(title.right - tools.left),
      toolsOverflowBy: Math.round(tools.right - headRect.right),
      toolsWidth: Math.round(toolsWidth),
    };
  });

  // the title ellipsizes; it never reaches under the tool cluster…
  expect(overlap.titleOverToolsBy).toBeLessThanOrEqual(0);
  // …and the tools keep their full width inside the header
  expect(overlap.toolsOverflowBy).toBeLessThanOrEqual(0);
  expect(overlap.toolsWidth).toBeGreaterThan(60);
});
