# rotli — UI/UX mockups · round 7 — Voice module — DECISION

**Date:** 2026-06-11 · **Gate:** `gate.html` (live render, kit tokens only; root pinned light)
**Input:** the maintainer's pushback on r6: Voice also moves ahead of the Memory — it's just STT + TTS
(whisper + the same open-source voice engines breve uses) plus a light cleanup pass on the bundled model.

## Designed this round (pending gate)

1. **Dictate** (frame A) — ⌥⌘V (rebindable), system-wide: the cocoa pill is the only UI. Whisper
   transcribes locally; the bundled model strips filler and repairs sentences (Wispr-Flow behavior,
   the maintainer's explicit ask); clean text lands at the caret on the peach tint. **Cleanup is the default;
   "verbatim" is a Settings → Voice toggle.** Raw-vs-written comparison shown at the gate.
2. **Listen** (frame B) — "Read aloud" via ⌘K / ⌥⌘P / a small speaker in the note header. While
   playing, the bottom-center slot (the format bar's home) becomes the player — one resident at a time.
   The sentence being spoken carries the peach tint. Two bundled voices (warm · clear), 0.8–2×,
   same engines as breve — one voice stack across the SM family.
3. **Voice mode** (frame C) — the same Chat backend (session, /model, note-tagging, sidecar transcript)
   worn as a voice-first surface: breathing orb (opacity/scale only, reduced-motion safe), current line
   as caption, controls: Mute · See as chat · Tag a note · End. Header note: nothing leaves this Mac.
4. **Order v2** (frame D): **Notes → Chat → Voice → Memory → Inbox → Board.** Chat + Voice ship as one
   wave (shared model runtime + speech engines, shared backend). Switcher footer: *one brain underneath —
   Notes writes it, Chat talks with it, Voice speaks it, the Memory recalls it.*

## Open question raised at the gate

Dictation has **no Chat dependency** — whisper + cleanup could ship as a Notes v1 *feature*, with the
Voice module proper (listen + voice mode) arriving in the Chat/Voice wave. the maintainer to call.

## Round-7 calls for the maintainer

1. Dictation: cleanup-by-default, system-wide, ⌥⌘V — approve?
2. Listen: player replaces format bar while playing; tinted spoken sentence — approve?
3. Voice mode: orb over the Chat backend — approve?
4. Order v2 — lock into ROADMAP? And: pull dictation forward into Notes v1?

## Addendum — STT engine direction (the maintainer, same day)

the maintainer prefers no OpenAI lineage. Clarified: Whisper/whisper.cpp is MIT open source with zero OpenAI
dependency (frozen weights, no API) — but 2026's best open models are non-OpenAI anyway, so the swap is
free. **Direction:** Parakeet TDT (NVIDIA, CC-BY-4.0, fastest/streaming) as bundled default ·
Moonshine (tiny, 27MB-class) as the lite fallback · Qwen3-ASR (52 languages) as the multilingual option.
All behind an `SttService` interface (one-file swap, same pattern as MailProvider/OcrService) — engine is
config, not marriage. Verify exact license texts + Spanish coverage at build time; supersedes STACK.md's
whisper.cpp entry when STACK is next revised. TTS unchanged (breve's open engines — never OpenAI).

**LOCKED (same day):** a reference Apple Silicon development machine verified Parakeet TDT
(0.6B, ~1.2 GB fp16) runs faster-than-realtime on far weaker Apple Silicon → **Parakeet TDT is the
bundled STT default.** Moonshine remains the lite fallback for low-spec user machines at public ship;
Qwen3-ASR the multilingual option in Settings → Voice.

## Verdict

**APPROVED — the maintainer, 2026-06-11 ("this is great, now let's lock in all of this").** All calls in this round are locked, including the phase-pill switcher variant, header-inline status, Proton-first order, the chat/voice designs, order v2, and pulling dictation into Notes v1.
