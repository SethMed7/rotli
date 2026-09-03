// Streaming helpers for on-device chat.
//
// Two pieces make the local model answer "as it thinks":
//   1. `channelStream` bridges a Tauri Channel (push) into an async generator
//      (pull) — the Rust `chat_messages_stream` command sends one NDJSON token
//      per Channel message and resolves with the full text; this turns that into
//      `for await (const token of …)` and a return value.
//   2. `makeFinalExtractor` pulls the user-facing answer out of the model's
//      GROWING reply as tokens arrive. The loop's on-device model replies with a
//      single JSON object — `{"thought":"…","final":"…"}` for an answer, or
//      `{"thought":"…","tool":"…","args":{…}}` for a tool step. The extractor
//      streams ONLY the decoded `final` string (skipping `thought`), emits
//      nothing for a tool step, and — in prose mode (the force-final prompt asks
//      for bare Markdown) — streams non-JSON output verbatim. So the surface
//      shows the answer forming, never the JSON scaffolding or an about-to-be
//      tool call.

/** Bridge a callback-push token source into an async generator that yields each
 * token and returns the full accumulated text. `start` receives the per-token
 * callback and returns the completion promise (the full reply). */
export function channelStream(
  start: (onToken: (segment: string) => void) => Promise<string>,
): AsyncGenerator<string, string, void> {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let settled = false;
  let full = "";
  let error: unknown = null;
  const pump = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const settledP = start((segment) => {
    queue.push(segment);
    pump();
  }).then(
    (f) => {
      full = f;
    },
    (e) => {
      error = e;
    },
  );
  void settledP.finally(() => {
    settled = true;
    pump();
  });
  return (async function* () {
    for (;;) {
      while (queue.length > 0) yield queue.shift()!;
      if (settled) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    await settledP; // errors were captured, not thrown, by the handlers above
    if (error)
      throw error instanceof Error ? error : new Error(typeof error === "string" ? error : "stream failed");
    return full;
  })();
}

export interface FinalExtractor {
  /** Feed the next raw token segment; returns any newly-decodable final-answer
   * text to surface (empty string when there's nothing to show yet). */
  push(segment: string): string;
  /** How this reply has classified so far.
   * - `pending` — undecided (still reading the opening / an earlier field)
   * - `final`   — an answer: `finalText` is streaming
   * - `tool`    — a tool call: nothing to surface
   * - `other`   — non-JSON in strict (non-prose) mode: surface nothing */
  readonly mode: "pending" | "final" | "tool" | "other";
  /** The decoded final answer accumulated so far. */
  readonly finalText: string;
}

/** Drop a trailing INCOMPLETE JSON escape so `JSON.parse` never chokes on a
 * value we've only partly received (a lone `\` or a cut-off `\uXXX`). */
function trimIncompleteEscape(s: string): string {
  const backslashes = /(\\+)$/.exec(s);
  if (backslashes && backslashes[1]!.length % 2 === 1) s = s.slice(0, -1);
  return s.replace(/\\u[0-9a-fA-F]{0,3}$/, "");
}

/** Lenient fallback when a value isn't strictly valid JSON (a model emitting a
 * raw newline inside the string, say) — decode the common escapes by hand. */
function lenientUnescape(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_m, esc: string) => {
    if (esc[0] === "u") return String.fromCharCode(parseInt(esc.slice(1), 16));
    const map: Record<string, string> = {
      n: "\n",
      t: "\t",
      r: "\r",
      b: "\b",
      f: "\f",
      '"': '"',
      "\\": "\\",
      "/": "/",
    };
    return map[esc] ?? esc;
  });
}

/** Decode a (possibly still-growing) JSON string body into plain text. */
function decodeJsonStringBody(raw: string): string {
  const safe = trimIncompleteEscape(raw);
  try {
    return JSON.parse(`"${safe}"`) as string;
  } catch {
    return lenientUnescape(safe);
  }
}

/**
 * An incremental extractor over the model's growing reply. `proseIsFinal` marks
 * a generation that is expected to BE the final answer (the force-final prompt
 * asks for bare Markdown): non-JSON output then streams verbatim as the answer.
 * In the default (loop-step) mode, only a confirmed JSON `final` value streams;
 * a tool call or stray prose surfaces nothing.
 */
export function makeFinalExtractor(proseIsFinal: boolean): FinalExtractor {
  let buf = "";
  let pos = 0;
  // scanner state
  type St =
    | "seek"
    | "inObj"
    | "key"
    | "postKey"
    | "preVal"
    | "final"
    | "skipStr"
    | "skipVal"
    | "prose"
    | "stop";
  let st: St = "seek";
  let curKey = "";
  let esc = false; // shared escape flag for key / final / skipStr
  let skipDepth = 0; // brace/bracket depth while skipping a non-string value
  let skipInStr = false;
  let finalStart = -1; // index in buf where the final value body begins
  let finalEnd = -1; // index of its closing quote (exclusive); -1 while open
  let proseStart = -1;
  let emitted = 0; // chars already returned to the caller

  let mode: FinalExtractor["mode"] = "pending";
  let finalText = "";

  function scan(): void {
    while (pos < buf.length && st !== "stop" && st !== "prose") {
      const c = buf[pos]!;
      switch (st) {
        case "seek":
          if (c === " " || c === "\n" || c === "\r" || c === "\t") {
            pos++;
          } else if (c === "`") {
            // a leading ```lang fence — skip to the end of its line
            const nl = buf.indexOf("\n", pos);
            if (nl < 0) return; // wait for the rest of the fence line
            pos = nl + 1;
          } else if (c === "{") {
            st = "inObj";
            pos++;
          } else if (proseIsFinal) {
            st = "prose";
            proseStart = pos;
            mode = "final";
          } else {
            st = "stop";
            mode = "other";
          }
          break;
        case "inObj":
          if (c === " " || c === "\n" || c === "\r" || c === "\t" || c === ",") {
            pos++;
          } else if (c === "}") {
            st = "stop";
          } else if (c === '"') {
            st = "key";
            curKey = "";
            esc = false;
            pos++;
          } else {
            pos++; // tolerate anything unexpected
          }
          break;
        case "key":
          if (esc) {
            curKey += c;
            esc = false;
          } else if (c === "\\") {
            curKey += c;
            esc = true;
          } else if (c === '"') {
            st = "postKey";
          } else {
            curKey += c;
          }
          pos++;
          break;
        case "postKey":
          if (c === ":") st = "preVal";
          pos++;
          break;
        case "preVal": {
          if (c === " " || c === "\n" || c === "\r" || c === "\t") {
            pos++;
            break;
          }
          const key = decodeJsonStringBody(curKey);
          if (key === "tool") {
            mode = "tool";
            st = "stop";
            break;
          }
          if (key === "final") {
            if (c === '"') {
              st = "final";
              esc = false;
              finalStart = pos + 1;
              mode = "final";
              pos++;
            } else {
              st = "stop"; // a non-string `final` — nothing to stream
            }
            break;
          }
          // some other key (thought, args, …): skip its value
          if (c === '"') {
            st = "skipStr";
            esc = false;
            pos++;
          } else if (c === "{" || c === "[") {
            st = "skipVal";
            skipDepth = 1;
            skipInStr = false;
            esc = false;
            pos++;
          } else {
            st = "skipVal"; // a primitive — run to the next comma / close
            skipDepth = 0;
            skipInStr = false;
          }
          break;
        }
        case "final":
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') {
            finalEnd = pos;
            st = "stop";
          }
          pos++;
          break;
        case "skipStr":
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') st = "inObj";
          pos++;
          break;
        case "skipVal":
          if (skipDepth === 0) {
            if (c === "," || c === "}")
              st = "inObj"; // leave the delimiter for inObj
            else pos++;
            break;
          }
          if (skipInStr) {
            if (esc) esc = false;
            else if (c === "\\") esc = true;
            else if (c === '"') skipInStr = false;
          } else if (c === '"') {
            skipInStr = true;
            esc = false;
          } else if (c === "{" || c === "[") {
            skipDepth++;
          } else if (c === "}" || c === "]") {
            skipDepth--;
            if (skipDepth === 0) st = "inObj";
          }
          pos++;
          break;
        default:
          pos++;
      }
    }
  }

  function produce(): string {
    if (st === "prose") {
      const decoded = buf.slice(proseStart);
      finalText = decoded;
      const out = decoded.slice(emitted);
      emitted = decoded.length;
      return out;
    }
    if (mode === "final" && finalStart >= 0) {
      const body = buf.slice(finalStart, finalEnd >= 0 ? finalEnd : buf.length);
      const decoded = decodeJsonStringBody(body);
      finalText = decoded;
      if (decoded.length <= emitted) return "";
      const out = decoded.slice(emitted);
      emitted = decoded.length;
      return out;
    }
    return "";
  }

  return {
    push(segment: string): string {
      buf += segment;
      scan();
      return produce();
    },
    get mode() {
      return mode;
    },
    get finalText() {
      return finalText;
    },
  };
}
