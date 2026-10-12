import { expect, test } from "bun:test";

import { Speaker } from "./speech";

/** An AudioContext stand-in: sources end when `finish()` is called (or at
 * once with `autoEnd`), and a closed context never fires `onended` — the way
 * a real one swallows a stopped source. */
function fakeAudio(autoEnd: boolean) {
  const contexts: { closed: boolean; played: number }[] = [];
  const pending: (() => void)[] = [];
  const make = () => {
    const record = { closed: false, played: 0 };
    contexts.push(record);
    return {
      destination: {},
      createBuffer: (_channels: number, length: number) => {
        const data = new Float32Array(length);
        return { getChannelData: () => data };
      },
      createBufferSource: () => {
        const source = {
          buffer: null as unknown,
          onended: null as (() => void) | null,
          connect: () => {},
          start: () => {
            record.played++;
            const end = () => !record.closed && source.onended?.();
            if (autoEnd) queueMicrotask(end);
            else pending.push(end);
          },
          stop: () => {},
        };
        return source;
      },
      close: async () => {
        record.closed = true;
      },
    } as unknown as AudioContext;
  };
  return { make, contexts, finish: () => pending.splice(0).forEach((end) => end()) };
}

const tts = { generate: async (text: string) => ({ audio: new Float32Array(text.length) }) };

test("a finished read closes its audio context, and the next read opens a fresh one", async () => {
  const audio = fakeAudio(true);
  const speaker = new Speaker(audio.make, async () => tts);
  await speaker.read("m1", ["One.", "Two."], "af_bella");
  expect(audio.contexts).toEqual([{ closed: true, played: 2 }]);
  await speaker.read("m2", ["Three."], "af_bella");
  expect(audio.contexts).toEqual([
    { closed: true, played: 2 },
    { closed: true, played: 1 },
  ]);
  expect(speaker.snapshot()).toEqual({ state: "idle", owner: null });
});

test("stop mid-sentence closes the context, settles playback, and a new read still plays", async () => {
  const audio = fakeAudio(false);
  const speaker = new Speaker(audio.make, async () => tts);
  const first = speaker.read("m1", ["One.", "Two."], "af_bella");
  while (audio.contexts[0]?.played !== 1) await new Promise((r) => setTimeout(r, 5));
  speaker.stop();
  await first;
  expect(audio.contexts[0]).toEqual({ closed: true, played: 1 });

  const second = speaker.read("m2", ["Three."], "af_bella");
  while (audio.contexts[1]?.played !== 1) await new Promise((r) => setTimeout(r, 5));
  audio.finish();
  await second;
  expect(audio.contexts[1]).toEqual({ closed: true, played: 1 });
  expect(speaker.snapshot()).toEqual({ state: "idle", owner: null });
});
