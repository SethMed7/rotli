// The Claude session adapter's event decoding and round trip: a tool_call event
// names the call, its arguments are read by command, and every call is answered.

import { afterEach, describe, expect, test } from "bun:test";

import { claudeSession, parseToolArgs, parseToolCallEvent } from "./claudeSession";
import { promptOf } from "./promptText.fixtures";

type Callback = (message: unknown) => void;

// What @tauri-apps/api's invoke and Channel call on the Mac app (the IPC mock's
// own seam), so the adapter is driven without a webview.
const host = window as unknown as { __TAURI_INTERNALS__?: unknown };
afterEach(() => {
  delete host.__TAURI_INTERNALS__;
});

/** A fake Rust side: the session's run command sends one tool_call event per entry of
 * `args`, serves each call's arguments once, and resolves when every call is answered. */
function fakeRust(args: Record<string, string | Error>) {
  const callbacks = new Map<number, Callback>();
  const answers: { callId: string; result: string }[] = [];
  const served = new Set<string>();
  let finish = () => {};
  host.__TAURI_INTERNALS__ = {
    transformCallback: (callback: Callback) => {
      const id = callbacks.size + 1;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    invoke: async (cmd: string, payload: Record<string, unknown>) => {
      const command = cmd.replace(/^claude_session_/, "");
      if (command === "run") {
        const channel = callbacks.get(Number(String((payload.onEvent as { id: number }).id)));
        const done = new Promise<string>((resolve) => {
          finish = () => resolve("final answer");
        });
        Object.keys(args).forEach((callId, index) =>
          channel?.({ message: JSON.stringify({ type: "tool_call", callId, name: "create_note" }), index }),
        );
        return done;
      }
      const callId = String(payload.callId);
      if (command === "tool_args") {
        const value = args[callId];
        if (value instanceof Error) throw value;
        if (served.has(callId)) throw new Error("that tool call has ended");
        served.add(callId);
        return value;
      }
      if (command === "tool_result") {
        answers.push({ callId, result: String(payload.result) });
        if (answers.length === Object.keys(args).length) finish();
      }
      return undefined;
    },
  };
  return answers;
}

const req = {
  model: "sonnet",
  systemPrompt: promptOf("system"),
  userText: promptOf("user"),
  tools: [],
  maxTurns: 4,
};

describe("claudeSession", () => {
  test("only well-formed tool_call events reach the loop", () => {
    expect(parseToolCallEvent('{"type":"tool_call","callId":"c1","name":"read_note"}')).toEqual({
      callId: "c1",
      name: "read_note",
    });
    expect(parseToolCallEvent('{"type":"tool_call","callId":"c1"}')).toBeNull();
    expect(parseToolCallEvent('{"type":"text","text":"hi"}')).toBeNull();
    expect(parseToolCallEvent("not json")).toBeNull();
  });

  test("arguments are a JSON object or nothing", () => {
    expect(parseToolArgs('{"id":"n1"}')).toEqual({ id: "n1" });
    expect(parseToolArgs("[1]")).toEqual({});
    expect(parseToolArgs("null")).toEqual({});
    expect(parseToolArgs("not json")).toEqual({});
  });

  test("a long tool call arrives whole, and every call is answered in order", async () => {
    const body = `"quoted"\n${"x".repeat(20_000)}`;
    const answers = fakeRust({
      c1: JSON.stringify({ title: "Long note", body }),
      c2: JSON.stringify({ title: "Short" }),
    });
    const seen: Record<string, unknown>[] = [];
    const answer = await claudeSession("r1")(req, async (call) => {
      seen.push(call.args);
      return promptOf(`done ${call.callId}`);
    });
    expect(answer).toBe("final answer");
    expect(seen).toEqual([{ title: "Long note", body }, { title: "Short" }]);
    expect(answers).toEqual([
      { callId: "c1", result: "done c1" },
      { callId: "c2", result: "done c2" },
    ]);
  });

  test("a call whose arguments can't be read is answered with an error, not left waiting", async () => {
    const answers = fakeRust({ c1: new Error("that tool call has ended") });
    let ran = false;
    await claudeSession("r1")(req, async () => {
      ran = true;
      return promptOf("never");
    });
    expect(ran).toBe(false);
    expect(answers).toEqual([{ callId: "c1", result: "error: that tool call has ended" }]);
  });
});
