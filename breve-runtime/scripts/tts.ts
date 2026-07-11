/**
 * Shared Kokoro TTS renderer for BREVE audio — multi-voice "podcast" style.
 * A script is plain prose with optional voice markers on their own lines:
 *   [[anchor]]   warm US female (af_heart)  — main news, default
 *   [[security]] male (am_michael)          — security / action items: the "sit up" voice
 *   [[personal]] British female (bf_emma)   — personal topics
 * Text before any marker reads as anchor. Unknown markers fall back to anchor.
 * Fully on-device (kokoro-js, models cached after first download).
 */
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Pronunciation dictionary — respell words Kokoro mispronounces (e.g. "Breve" → "Brevay").
// Editable at ../pronunciation.json; applied to the SPOKEN text only, just before synthesis.
let LEXICON: Array<[RegExp, string]> | null = null;
function lexicon(): Array<[RegExp, string]> {
  if (LEXICON) return LEXICON;
  LEXICON = [];
  try {
    const root = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");
    const raw = JSON.parse(readFileSync(join(root, "pronunciation.json"), "utf8"));
    for (const [word, say] of Object.entries((raw.words ?? {}) as Record<string, string>)) {
      const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      LEXICON.push([new RegExp(`\\b${esc}\\b`, "gi"), String(say)]);
    }
  } catch { /* no dictionary → say words as written */ }
  return LEXICON;
}
function respell(text: string): string {
  let t = text;
  for (const [re, say] of lexicon()) t = t.replace(re, say);
  return t;
}

export const VOICES: Record<string, string> = {
  anchor: "af_heart",
  security: "am_michael",
  personal: "bf_emma",
};

// The cast — named so hosts hand off person-to-person ("Over to you, Marcus"),
// not role-to-role ("back to the anchor"). Names appear in scripts only; the
// role keys above stay the technical interface.
export const CAST: Record<string, { name: string; role: string }> = {
  anchor: { name: "Ava", role: "main host" },
  security: { name: "Marcus", role: "security correspondent" },
  personal: { name: "Emma", role: "culture host" },
};

export type Segment = { voice: string; text: string };

export function parseSegments(script: string): Segment[] {
  // Markers may sit on their own line or inline ("[[security]] One item…").
  const parts = script.split(/\[\[\s*(\w+)\s*\]\]/);
  const segments: Segment[] = [];
  const push = (voice: string, text: string) => {
    text = text.trim();
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.voice === voice) last.text += "\n" + text;
    else segments.push({ voice, text });
  };
  push("anchor", parts[0] ?? "");
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i].toLowerCase();
    push(VOICES[name] ? name : "anchor", parts[i + 1] ?? "");
  }
  return segments.length ? segments : [{ voice: "anchor", text: script.trim() }];
}

function chunkText(text: string, max = 400): string[] {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length > max) { chunks.push(cur.trim()); cur = ""; }
    cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

const SR = 24000;

function toWav(samples: Float32Array, sr: number): Buffer {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write("RIFF", 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write("WAVE", 8);
  data.write("fmt ", 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sr, 24); data.writeUInt32LE(sr * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return data;
}

/** Render a (possibly multi-voice) script to mp3 (or m4a/AAC — picked by the
 *  output extension; Signal voice notes want AAC). `voices` overrides the role
 *  map per-call (e.g. {anchor: "af_bella"} for the owner's chosen chat voice).
 *  Returns duration in minutes. */
export async function renderMp3(script: string, mp3Path: string, voices: Record<string, string> = {}): Promise<number> {
  // Keep model downloads in ~/.cache, not inside the memex's node_modules
  const { env: hfEnv } = await import("@huggingface/transformers");
  hfEnv.cacheDir = `${process.env.HOME}/.cache/huggingface-transformers`;
  const { KokoroTTS } = await import("kokoro-js");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8",
    device: "cpu",
  });

  const V = { ...VOICES, ...voices };
  const segments = parseSegments(script);
  const CHUNK_GAP = new Float32Array(Math.round(SR * 0.35)); // breath between chunks
  const VOICE_GAP = new Float32Array(Math.round(SR * 0.7));  // beat on a voice handoff
  const parts: Float32Array[] = [];
  const totalChunks = segments.reduce((n, s) => n + chunkText(s.text).length, 0);
  let done = 0;
  for (const seg of segments) {
    for (const chunk of chunkText(seg.text)) {
      const audio = await tts.generate(respell(chunk), { voice: V[seg.voice] as any });
      parts.push(audio.audio as Float32Array, CHUNK_GAP);
      if (++done % 5 === 0) console.log(`[tts] ${done}/${totalChunks} (${seg.voice})…`);
    }
    parts.push(VOICE_GAP);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const pcm = new Float32Array(total);
  let off = 0;
  for (const p of parts) { pcm.set(p, off); off += p.length; }

  const wavPath = mp3Path.replace(/\.(mp3|m4a)$/, ".tmp.wav");
  writeFileSync(wavPath, toWav(pcm, SR));
  const codec = mp3Path.endsWith(".m4a") ? ["-codec:a", "aac", "-b:a", "48k"] : ["-codec:a", "libmp3lame", "-b:a", "64k"];
  const ff = Bun.spawn(
    ["ffmpeg", "-y", "-loglevel", "error", "-i", wavPath, ...codec, "-metadata", "artist=Breve", mp3Path],
    { stdout: "ignore", stderr: "pipe" }
  );
  const ffErr = await new Response(ff.stderr).text();
  const code = await ff.exited;
  unlinkSync(wavPath);
  if (code !== 0) throw new Error(`ffmpeg: ${ffErr.slice(0, 300)}`);
  return total / SR / 60;
}
