import { describe, expect, test } from "bun:test";
import { EMPTY_SCENE, createBoardSaver, parseBoardBody, serializeBoardScene } from "./session";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("parseBoardBody", () => {
  test("empty source fails closed instead of becoming an autosavable blank scene", () => {
    expect(() => parseBoardBody("")).toThrow("original file was not changed");
    expect(() => parseBoardBody("  \n ")).toThrow("original file was not changed");
  });

  test("corrupt JSON fails closed instead of becoming an autosavable blank scene", () => {
    expect(() => parseBoardBody("{not json")).toThrow("original file was not changed");
  });

  test("lifts top-level rotliMeta out of the scene", () => {
    const body = JSON.stringify({
      ...EMPTY_SCENE,
      rotliMeta: { description: "wiring diagram", tags: "home, electrical" },
    });
    const { meta } = parseBoardBody(body);
    expect(meta).toEqual({ description: "wiring diagram", tags: "home, electrical" });
  });

  test("missing or partial rotliMeta defaults to empty strings", () => {
    const { meta } = parseBoardBody(JSON.stringify({ ...EMPTY_SCENE, rotliMeta: { tags: "x" } }));
    expect(meta).toEqual({ description: "", tags: "x" });
  });

  test("rejects excessive elements, strings, and coordinates", () => {
    expect(() =>
      parseBoardBody(
        JSON.stringify({ ...EMPTY_SCENE, elements: Array.from({ length: 10_001 }, () => ({})) }),
      ),
    ).toThrow("too many elements");
    expect(() =>
      parseBoardBody(
        JSON.stringify({ ...EMPTY_SCENE, elements: [{ type: "text", text: "x".repeat(100_001) }] }),
      ),
    ).toThrow("string that is too long");
    expect(() =>
      parseBoardBody(JSON.stringify({ ...EMPTY_SCENE, elements: [{ type: "rectangle", x: 10_000_001 }] })),
    ).toThrow("coordinate outside");
    expect(() =>
      parseBoardBody(
        JSON.stringify({ ...EMPTY_SCENE, elements: [{ type: "line", points: [[0, 10_000_001]] }] }),
      ),
    ).toThrow("coordinate outside");
  });

  test("validates element and Rotli metadata shapes", () => {
    expect(() => parseBoardBody(JSON.stringify({ ...EMPTY_SCENE, elements: ["not-an-element"] }))).toThrow(
      "elements must be objects",
    );
    expect(() =>
      parseBoardBody(JSON.stringify({ ...EMPTY_SCENE, rotliMeta: { description: { nested: true } } })),
    ).toThrow("rotliMeta description must be a string");
  });
});

describe("serializeBoardScene", () => {
  test("strips volatile collaborators and carries rotliMeta", () => {
    const body = serializeBoardScene({
      elements: [{ id: "a" }],
      appState: { zoom: 1, collaborators: new Map() },
      files: {},
      meta: { description: "d", tags: "t" },
    });
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed.type).toBe("excalidraw");
    expect(parsed.rotliMeta).toEqual({ description: "d", tags: "t" });
    expect("collaborators" in (parsed.appState as Record<string, unknown>)).toBe(false);
  });

  test("persists only the DURABLE appState — pan/zoom/selection are churn, not content (boards slice 2026-07-28)", () => {
    // a vault is a git repo: panning a board must not dirty the file
    const body = serializeBoardScene({
      elements: [],
      appState: {
        viewBackgroundColor: "linen",
        gridSize: 20,
        gridModeEnabled: true,
        scrollX: 812,
        scrollY: -40,
        zoom: { value: 1.5 },
        selectedElementIds: { a: true },
        activeTool: { type: "rectangle" },
        cursorButton: "down",
      },
      files: {},
      meta: { description: "", tags: "" },
    });
    const appState = (JSON.parse(body) as { appState: Record<string, unknown> }).appState;
    expect(appState).toEqual({ viewBackgroundColor: "linen", gridSize: 20, gridModeEnabled: true });
  });

  test("round-trips meta through parseBoardBody", () => {
    const meta = { description: "hello", tags: "a, b" };
    const body = serializeBoardScene({ elements: [], appState: {}, files: {}, meta });
    expect(parseBoardBody(body).meta).toEqual(meta);
  });
});

describe("createBoardSaver", () => {
  test("schedule coalesces to the freshest builder and SERIALIZES ONCE per drain", async () => {
    // Excalidraw fires onChange on every pointer move — serialization must run
    // at most once per debounce fire, not per event (boards slice 2026-07-28)
    const writes: string[] = [];
    let builds = 0;
    const saver = createBoardSaver((body) => {
      writes.push(body);
      return Promise.resolve();
    });
    saver.schedule(() => "v1");
    saver.schedule(() => {
      builds++;
      return "v2";
    });
    expect(writes).toEqual([]); // debounced — nothing until the timer or a flush
    expect(builds).toBe(0); // and NOTHING serialized yet either
    await saver.flush();
    await tick();
    expect(writes).toEqual(["v2"]);
    expect(builds).toBe(1);
    await saver.flush(); // pending already drained — no duplicate write
    await tick();
    expect(writes).toEqual(["v2"]);
  });

  test("a body identical to the primed baseline (or the last save) never writes", async () => {
    // opening a board, panning, or selecting must leave the file untouched —
    // the vault is a git repo and mtime feeds recency
    const writes: string[] = [];
    const saver = createBoardSaver((body) => {
      writes.push(body);
      return Promise.resolve();
    });
    saver.prime("loaded");
    saver.schedule(() => "loaded");
    await saver.flush();
    await tick();
    expect(writes).toEqual([]); // unchanged → skipped
    saver.schedule(() => "drawn");
    await saver.flush();
    await tick();
    expect(writes).toEqual(["drawn"]);
    saver.schedule(() => "drawn"); // unchanged since the last save
    await saver.flush();
    await tick();
    expect(writes).toEqual(["drawn"]);
  });

  test("a throwing builder surfaces through onResult and writes nothing", async () => {
    const writes: string[] = [];
    const results: (string | null)[] = [];
    const saver = createBoardSaver(
      (body) => {
        writes.push(body);
        return Promise.resolve();
      },
      (err) => results.push(err),
    );
    saver.schedule(() => {
      throw new Error("scene too large");
    });
    await saver.flush();
    await tick();
    expect(writes).toEqual([]);
    expect(results).toEqual(["scene too large"]);
  });

  test("saveNow bypasses the debounce without draining a pending body", async () => {
    const writes: string[] = [];
    const saver = createBoardSaver((body) => {
      writes.push(body);
      return Promise.resolve();
    });
    saver.schedule(() => "pending");
    saver.saveNow("meta");
    await tick();
    expect(writes).toEqual(["meta"]);
    await saver.flush();
    await tick();
    expect(writes).toEqual(["meta", "pending"]);
  });

  test("onResult surfaces the write error and clears on the next success", async () => {
    const results: (string | null)[] = [];
    let fail = true;
    const saver = createBoardSaver(
      () => (fail ? Promise.reject(new Error("disk full")) : Promise.resolve()),
      (err) => results.push(err),
    );
    saver.saveNow("x");
    await tick();
    fail = false;
    saver.saveNow("x");
    await tick();
    expect(results).toEqual(["disk full", null]);
  });
});
