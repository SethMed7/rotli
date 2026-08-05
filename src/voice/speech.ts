// Reading a reply aloud — the Kokoro seam (voice tier "read aloud", 2026-08-04).
//
// One speaker for the whole app: starting a new read stops the previous one, so
// two messages can never talk over each other. Sentences are synthesized and
// queued as they arrive (src/voice/sentences.ts does the cutting), which is what
// lets playback begin while the model is still writing.
//
// The model is loaded LAZILY and never on app start: `kokoro-js` fetches its
// weights on first use, so nobody pays for a voice they never asked for
// (docs/design/voice.md — "install only what you want"). `state` reports that
// first-use preparation so the UI can say so instead of looking broken.
//
// TTS is OUTPUT only. It needs no microphone, no entitlement, and nothing leaves
// the Mac — which is why this tier ships ahead of dictation.

export type SpeechState = "idle" | "preparing" | "speaking";

/** Kokoro's shipped voices, as the picker offers them. */
export const VOICES = [
  { id: "af_bella", label: "Bella" },
  { id: "af_heart", label: "Heart" },
  { id: "af_nicole", label: "Nicole" },
  { id: "am_michael", label: "Michael" },
  { id: "am_puck", label: "Puck" },
  { id: "bf_emma", label: "Emma" },
  { id: "bm_george", label: "George" },
] as const;

export const DEFAULT_VOICE = "af_bella";

type Listener = (state: SpeechState, owner: string | null) => void;

interface KokoroLike {
  generate: (text: string, opts: { voice: string }) => Promise<{ audio: Float32Array }>;
}

let engine: KokoroLike | null = null;
let loading: Promise<KokoroLike> | null = null;

/** Load Kokoro once per session. Exported so a caller can warm it deliberately
 * (a Settings "prepare voice" button) rather than paying the wait mid-sentence. */
export async function loadEngine(): Promise<KokoroLike> {
  if (engine) return engine;
  loading ??= (async () => {
    const { KokoroTTS } = (await import("kokoro-js")) as unknown as {
      KokoroTTS: { from_pretrained: (repo: string, opts: unknown) => Promise<KokoroLike> };
    };
    // q8 on CPU — the same dtype Breve's brief audio uses, and small enough to
    // synthesize a sentence faster than it takes to say the previous one
    engine = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: "q8",
      device: "cpu",
    });
    return engine;
  })();
  try {
    return await loading;
  } catch (e) {
    loading = null; // a failed load must not poison every later attempt
    throw e;
  }
}

/** The app's single speaker. */
class Speaker {
  private state: SpeechState = "idle";
  /** Which message is being read — the UI lights only that row's button. */
  private owner: string | null = null;
  private listeners = new Set<Listener>();
  /** Bumped by stop() and by a new read; a stale run checks it and gives up. */
  private run = 0;
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private queue: Float32Array[] = [];
  private draining = false;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  snapshot(): { state: SpeechState; owner: string | null } {
    return { state: this.state, owner: this.owner };
  }

  private emit(state: SpeechState, owner: string | null): void {
    this.state = state;
    this.owner = owner;
    for (const fn of this.listeners) fn(state, owner);
  }

  /** Stop immediately — a new read, an explicit stop, or the surface unmounting. */
  stop(): void {
    this.run++;
    this.queue = [];
    this.draining = false;
    try {
      this.source?.stop();
    } catch {
      /* already ended */
    }
    this.source = null;
    this.emit("idle", null);
  }

  /**
   * Read `text` aloud as `owner`. Resolves when speech finishes (or is stopped).
   * Sentences are synthesized one at a time and played in order, so the first
   * words are audible long before the last are generated.
   */
  async read(owner: string, sentences: readonly string[], voice: string): Promise<void> {
    this.stop(); // one speaker: a new read always wins
    const mine = ++this.run;
    if (sentences.length === 0) return;

    this.emit(engine ? "speaking" : "preparing", owner);
    let tts: KokoroLike;
    try {
      tts = await loadEngine();
    } catch {
      if (this.run === mine) this.emit("idle", null);
      throw new Error("the voice couldn't be prepared");
    }
    if (this.run !== mine) return; // stopped while the model loaded
    this.emit("speaking", owner);

    for (const sentence of sentences) {
      if (this.run !== mine) return;
      try {
        const { audio } = await tts.generate(sentence, { voice });
        if (this.run !== mine) return;
        this.queue.push(audio);
        void this.drain(mine);
      } catch {
        /* one unsayable sentence must not end the whole read */
      }
    }
    // wait for playback to catch up with synthesis
    while (this.run === mine && (this.draining || this.queue.length > 0)) {
      await new Promise((r) => setTimeout(r, 60));
    }
    if (this.run === mine) this.emit("idle", null);
  }

  /** Play queued chunks back-to-back so sentences run together as speech. */
  private async drain(mine: number): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && this.run === mine) {
        const chunk = this.queue.shift();
        if (!chunk) break;
        await this.play(chunk, mine);
      }
    } finally {
      this.draining = false;
    }
  }

  private play(samples: Float32Array, mine: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.run !== mine) return resolve();
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      // Kokoro renders 24 kHz mono
      const buffer = ctx.createBuffer(1, samples.length, 24_000);
      // copy into the buffer's own channel storage — Kokoro's Float32Array may
      // be backed by a SharedArrayBuffer, which copyToChannel won't accept
      buffer.getChannelData(0).set(samples);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => resolve();
      this.source = source;
      source.start();
    });
  }
}

export const speaker = new Speaker();
