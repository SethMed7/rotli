// Dev React's profiler fields let this guard count real host-row renders,
// without wall-clock thresholds or a production instrumentation hook.
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

type Fiber = {
  child: Fiber | null;
  sibling: Fiber | null;
  actualStartTime: number;
  memoizedProps?: { className?: string };
};

declare global {
  interface Window {
    mainRowCommits: number[];
  }
}

function recordMainRowCommits() {
  window.mainRowCommits = [];
  let lastCommit = 0;
  let rendererId = 0;
  const renderers = new Map<number, unknown>();
  Object.assign(window, {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true,
      renderers,
      inject: (renderer: unknown) => {
        renderers.set(++rendererId, renderer);
        return rendererId;
      },
      onCommitFiberUnmount: () => {},
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        let rows = 0;
        const pending = [root.current];
        while (pending.length) {
          const fiber = pending.pop();
          if (!fiber) continue;
          if (
            fiber.actualStartTime >= lastCommit &&
            fiber.memoizedProps?.className?.split(" ").includes("main-row")
          )
            rows++;
          if (fiber.child) pending.push(fiber.child);
          if (fiber.sibling) pending.push(fiber.sibling);
        }
        window.mainRowCommits.push(rows);
        lastCommit = performance.now();
      },
    },
  });
}

test("switching Main notes renders only changed rows, with every row still mounted", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(recordMainRowCommits);
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
  await gotoApp(page);
  await page.evaluate(async () => {
    const mounted = async (path: string) => {
      const url = performance
        .getEntriesByType("resource")
        .find((entry) => new URL(entry.name).pathname === path)?.name;
      if (!url) throw new Error(`Module not mounted: ${path}`);
      return import(/* @vite-ignore */ url);
    };
    const [{ notesService }, { invalidateNotes }, { useMainStore }, { usePanesStore }] = await Promise.all([
      mounted("/src/services/notes.ts"),
      mounted("/src/services/hooks.ts"),
      mounted("/src/state/main.ts"),
      mounted("/src/state/panes.ts"),
    ]);
    const notes = Array.from({ length: 120 }, (_, index) => ({
      id: `render-${index}`,
      title: `Render probe ${index}`,
      folderId: "Probe",
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      snippet: "Synthetic render guard",
      body: `# Render probe ${index}\n\nSynthetic render guard`,
      revision: `memory:${index + 1}`,
      kind: "note",
    }));
    notesService.importSnapshot({
      version: 1,
      folders: [{ id: "Probe", name: "Probe", parentId: null }],
      notes,
      origins: {},
      revisionCounter: notes.length,
    });
    await invalidateNotes();
    useMainStore.getState().setTree(
      notes.map((note) => ({ note: note.id })),
      new Set(notes.map((note) => note.id)),
    );
    usePanesStore.getState().openNote(notes[0]!.id, { newTab: true });
  });
  const rows = page.locator(".main-tree [data-note-id]");
  await expect(rows).toHaveCount(120);
  await expect(page.locator(".cm-content").last()).toContainText("Render probe 0");
  // Fail closed if a React upgrade removes the profiler fields this guard reads.
  expect(await page.evaluate(() => Math.max(...window.mainRowCommits))).toBeGreaterThanOrEqual(120);
  for (const index of [3, 118, 7]) {
    await page.evaluate(() => {
      window.mainRowCommits = [];
    });
    await page.locator(`.main-tree [data-note-id="render-${index}"] .main-note-open`).click();
    await expect(page.locator(".cm-content").last()).toContainText(`Render probe ${index}`);
    const commits = await page.evaluate(() => window.mainRowCommits);
    expect(commits.length).toBeGreaterThan(0);
    expect(Math.max(...commits)).toBeLessThanOrEqual(2);
    await expect(rows).toHaveCount(120);
  }
  // The shared callbacks must still navigate and activate the latest rows.
  const seventh = page.locator('[data-note-id="render-7"] .main-note-open');
  const eighth = page.locator('[data-note-id="render-8"] .main-note-open');
  await seventh.focus();
  await seventh.press("ArrowDown");
  await expect(eighth).toBeFocused();
  await eighth.press("Enter");
  await expect(page.locator(".cm-content").last()).toContainText("Render probe 8");
  await eighth.focus();
  await eighth.press("k");
  await expect(seventh).toBeFocused();
  expect(errors).toEqual([]);
});
