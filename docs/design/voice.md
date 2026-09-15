# Voice — dictation and talking with the AI

Status: read-aloud (tier 0) is built and ships in **development builds only**
(feature policy `voice`, 2026-09-14); stable Settings shows it as coming soon.
Dictation and talk-back below remain **designed, not built** (2026-08-04). Research verified against the
installed models and the CLIs on this machine; nothing here is speculative about
what rotli already owns.

the maintainer, 2026-08-04: *"the ability to sit there talk to the AI and it have TTS along
with STT… but we need to do it in a way that users can install only what they
want. If they want no model we can still just offer standard dictating that the
device supports. If they want AI to talk back to them like a call they need to
have a model for that. Ideally this should feel as realtime as possible."*

## The licensing finding — do NOT ship Fish Audio

Fish Audio was the suggested option. Its **code** is Apache-2.0 but its **model
weights are under the Fish Audio Research License**: research and non-commercial
use is free, and *any* commercial use requires a separate written agreement.
rotli reserves `1.0.0` for a public launch, so shipping those weights would put a
licensing obligation on the product.

Everything needed is already installed on this Mac, from warble, under licenses
that are genuinely commercial-safe:

| Job | Model | License | Status |
|---|---|---|---|
| Speech → text | `parakeet-tdt-0.6b-v2-int8` (+ the `sherpa-onnx` binaries) | CC-BY-4.0 | installed |
| Speech → text (alt) | `whisper-ggml-small-en` | MIT | installed |
| Text → speech | `kokoro-82m` | Apache-2.0 | installed; `kokoro-js` is already a rotli dependency |

So this is a wiring job, not a procurement one — and it stays 100% on-device,
which is the whole point of rotli.

## The tiers — install only what you want

Each tier is independently usable. Nothing below is a prerequisite for the tier
above it except where stated.

### Tier 0 — the device's own dictation (no install, no model, no permission)

macOS dictation types into whatever text field has focus, so it reaches the chat
composer without rotli capturing audio at all. **No microphone entitlement, no
model download, no rotli code on the audio path.** This is the honest default for
someone who wants none of the rest, and it must keep working even when every
other tier is uninstalled.

> Needs human verification in the real app before we claim it in release notes —
> a browser fixture cannot prove native dictation (AGENTS.md).

### Tier 1 — dictation with a local model (mic + one model)

A microphone button in the composer. Audio never leaves the Mac: `sherpa-onnx`
runs `parakeet`, which returns punctuated, capitalized text with better accuracy
than the OS for technical vocabulary.

Requires: the microphone entitlement (below) + a ~600 MB model the user chooses
to install.

### Tier 2 — talking with the AI, like a call (mic + TTS + a chat model)

Press to start a conversation: you speak, it answers aloud, you speak again. This
is the tier that genuinely needs a model, exactly as the maintainer framed it — the AI
can't talk back without one.

Requires: Tier 1 + `kokoro-82m` + any configured chat model.

## Making it feel realtime

Latency is the whole product here. The pipeline must overlap, never run in
stages:

1. **Voice activity detection** decides when an utterance ENDED, instead of
   waiting for the user to press stop. (`sherpa-onnx` ships a Silero VAD.)
2. **Transcribe the utterance immediately** on that boundary — parakeet is an
   *offline* recognizer, so the unit of work is one finished utterance, and the
   VAD is what keeps that from feeling like waiting.
3. **The answer already streams** token-by-token (shipped 0.70.0).
4. **Speak sentence-by-sentence as tokens arrive.** Kokoro is 82M and fast; the
   first sentence should be audible while the model is still writing the third.
   This single decision is the difference between "a call" and "a form
   submission" — never synthesize the whole answer first.
5. **Barge-in**: speaking again cancels playback and starts a new turn.

The queue discipline already exists for compute (`docs/design/local-compute-guardrails.md`)
and streaming already exists for tokens; the new work is the audio ring buffer
and the sentence splitter feeding TTS.

## Install machinery — reuse, don't invent

Voice models ride the **existing** memex-ai store and installer (`LOCAL_CATALOG`,
`installableCatalog`, `registry.json`), with a `kind` marking them as speech so
they surface in a Voice section of Settings rather than the chat model picker.
That gives per-model install/uninstall, disk-size display, and the "great fit /
workable / too big" sizing for free — and satisfies "install only what they
want" without a second download mechanism.

## The gate: the microphone entitlement

`src-tauri/entitlements.plist` is deliberately an **empty dict**, with a comment
stating rotli has "no audio/camera/network entitlements to declare." Tiers 1 and
2 need:

- `com.apple.security.device.audio-input` in the entitlements, and
- `NSMicrophoneUsageDescription` in the bundle's Info.plist.

That file is consumed by the signing + notarization path in `scripts/release.sh`,
so this is a **release-affecting change**: the first build after it lands is the
proof, and it must be notarized and Gatekeeper-checked before shipping. It is
also a visible, permanent change to what the app asks of the user — worth being
deliberate about rather than acquiring as a side effect.

**Tier 0 needs none of this.** TTS-only (reading a reply aloud) needs none of it
either — it is output, not capture. So the entitlement gates *dictation and
conversation*, and nothing else.

## Suggested order

1. **Read aloud** (Kokoro, no entitlement, no new permission) — proves the TTS
   path and the sentence-streaming discipline with zero signing risk.
2. **Entitlement + Tier 1 dictation** — one release whose sole risky change is
   the signing surface, verified end to end on a notarized build.
3. **Tier 2 conversation** — composes 1 and 2 with VAD and barge-in.

## Laws this must keep

- Audio and transcripts are user content: nothing leaves the Mac in tiers 0–2,
  and a secure-tainted chat must not be read aloud into a room by a remote model
  lane (the existing secure-context rules apply unchanged).
- No new UI framework; semantic tokens only; loading/empty/error/disabled states
  covered in every supported environment (AGENTS.md).
- Native audio claims need human-managed app evidence — browser fixtures don't
  count.
