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

  test("round-trips meta through parseBoardBody", () => {
    const meta = { description: "hello", tags: "a, b" };
    const body = serializeBoardScene({ elements: [], appState: {}, files: {}, meta });
    expect(parseBoardBody(body).meta).toEqual(meta);
  });
});

describe("createBoardSaver", () => {
  test("schedule coalesces to the freshest body; flush writes it once", async () => {
    const writes: string[] = [];
    const saver = createBoardSaver((body) => {
      writes.push(body);
      return Promise.resolve();
    });
    saver.schedule("v1");
    saver.schedule("v2");
    expect(writes).toEqual([]); // debounced — nothing until the timer or a flush
    saver.flush();
    await tick();
    expect(writes).toEqual(["v2"]);
    saver.flush(); // pending already drained — no duplicate write
    await tick();
    expect(writes).toEqual(["v2"]);
  });

  test("saveNow bypasses the debounce without draining a pending body", async () => {
    const writes: string[] = [];
    const saver = createBoardSaver((body) => {
      writes.push(body);
      return Promise.resolve();
    });
    saver.schedule("pending");
    saver.saveNow("meta");
    await tick();
    expect(writes).toEqual(["meta"]);
    saver.flush();
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
