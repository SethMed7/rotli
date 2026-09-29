// The Claude session adapter's event decoding: only well-formed tool calls from
// the native Channel reach the loop.

import { describe, expect, test } from "bun:test";

import { parseToolCall } from "./claudeSession";

describe("claudeSession", () => {
  test("only well-formed tool_call events reach the loop", () => {
    expect(parseToolCall('{"type":"tool_call","callId":"c1","name":"read_note","args":{"id":"n1"}}')).toEqual(
      {
        callId: "c1",
        name: "read_note",
        args: { id: "n1" },
      },
    );
    expect(parseToolCall('{"type":"tool_call","callId":"c1","name":"read_note"}')?.args).toEqual({});
    expect(parseToolCall('{"type":"text","text":"hi"}')).toBeNull();
    expect(parseToolCall("not json")).toBeNull();
  });
});
