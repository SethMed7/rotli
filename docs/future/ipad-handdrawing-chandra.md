# iPad hand-drawing → text with Chandra (future)

> **FUTURE / not scheduled.** This is a design note, not a plan of record. No code
> changes now, nothing wired, no dependency added. It captures *why Chandra fits* the
> planned rotli iPad app and *what we'd have to decide* before anyone builds it. When
> the iPad app is real, start here — until then this is a bookmark.
>
> Source: <https://www.datalab.to/blog/introducing-chandra> · repo
> <https://github.com/datalab-to/chandra> · weights
> <https://huggingface.co/datalab-to/chandra> · accessed **2026-07-06**.

## The context

The iPad app has one capability the Mac app doesn't: **hand-drawing / handwriting**
(Apple Pencil ink). Ink is lovely to capture and useless to search. rotli's whole
model is **plain markdown files you own** — a note that's a wall of vector strokes
isn't a note in the memex sense; you can't grep it, the organizer can't classify it,
the brain can't file the person you mentioned. So the iPad app needs a bridge:
**ink → searchable text/markdown**. Chandra is a strong candidate for that bridge.

## What Chandra is

Datalab's document-understanding / OCR model (same team as Marker + Surya). Current
release is **Chandra 2** (3/2026), a **~4B-parameter vision-language model** (Qwen-3-VL
lineage). It turns images and PDFs into structured **Markdown / HTML / JSON with layout
metadata**. Relevant to us:

- **Excellent handwriting support** — handwritten notes, handwritten math, handwritten
  forms are called out as first-class, not an afterthought.
- **Tables** (incl. merged cells), **math → LaTeX**, **forms + checkboxes**, multi-column
  **layout** reconstruction, image/diagram extraction with captions.
- **90+ languages.** Tops the external **olmOCR** benchmark for open models (Chandra 2
  ≈ **85.9%** olmOCR; multilingual avg **72.7%** vs Gemini 2.5 Flash 60.8% on their own
  90-language set — vendor numbers, treat as directional).
- Output is exactly the shape rotli wants: **Markdown with structure**, straight into a
  note body.

### How you'd access it

Three ways, and the choice *is* the integration:

1. **Open weights, self-hosted** — on Hugging Face (`datalab-to/chandra`). Two inference
   modes shipped: local **HuggingFace/torch** and **vLLM** server. Benchmarked on an
   H100 80GB; ~2 pages/s real-world. **4B is small enough to plausibly run quantized via
   MLX on Apple Silicon** — the same lane rotli already owns (the `~/.memex/ai` MLX
   server + the mlx-vlm vision sidecar). Not proven on-device yet; that's an open
   question, not a promise.
2. **Managed API** — Datalab's hosted platform ($5 free credits, zero-retention default,
   SOC 2). Easiest, but it's the cloud.
3. **Public playground** — for eyeballing quality only.

**Licensing:** code is **Apache 2.0**; **model weights are OpenRAIL-M (modified)** —
free for research / personal / small orgs, but **commercial self-hosting needs a
license**. This matters for rotli (below).

## Why it fits rotli specifically

- **Ink → markdown is the whole point.** Chandra's native output is structured markdown,
  so a recognized page drops into a note **body** with headings/lists/tables intact —
  no lossy "flatten to a text blob" step. That's the plain-files model, preserved.
- **It respects the memex shape.** A pencil page becomes a real note the **organizer**
  can then classify, enrich, and file like any other capture. Handwriting stops being a
  dead end and becomes first-class memex content.
- **Math + tables + forms**, not just prose — matches how people actually use a pencil
  (a diagram with a scribbled equation, a checklist, a sketched table).
- **rotli already has the runtime.** We run a local MLX model server and an isolated
  vision sidecar. A quantized Chandra could slot into that lane rather than being a new
  moving part.

## Integration considerations (for when this is real)

**On-device vs. API — the load-bearing decision.**
rotli is local-first and privacy-minded, and the **hard constraint is `secure`**: a
note flagged `secure` **never enters any model, local or remote** (and `locked` notes
the organizer never touches at all). Handwriting recognition is *a model call on note
content*, so it inherits that rule directly:

- **Default should be on-device** (MLX-quantized Chandra), so ink never leaves the Mac/
  iPad — consistent with how the organizer and local chat already behave.
- A **remote/API** path could exist as an *opt-in* for users who want max accuracy, but
  it must obey the same gate the remote-AI path already uses (`corpus_read_ai`): a
  `secure` page is **never** eligible to be sent off-device for recognition. If Chandra
  can only run remotely for a given user (no capable GPU), then secure pages simply
  **don't get OCR'd** — capture the ink, skip recognition, don't leak.

**Where recognized text lands.**
Follow the existing capture path — don't invent a new destination:

- A pencil page is a **capture**, so it stages into **`wiki/_inbox/`** and shows under
  the one **Captures** view, same as a typed ⌥C note.
- Recognized markdown goes in the **note body**; keep the **original ink** as an attached
  asset (in the memex `storage/`, referenced with a `storage:` link) so nothing is lost
  and the user can re-recognize later.
- Consider frontmatter breadcrumbs — e.g. a `source: ink` / `ocr: chandra@<ver>` field —
  so the organizer and the user can tell recognized text from typed text. (Recognition is
  lossy; don't pretend it's authoritative.)
- Then the normal **organizer** loop takes over: Classify → Enrich → file into the brain.

**Licensing / cost gating.**
rotli's rule is **prefer free/OSS, gate anything paid**. Chandra fits the *personal-use*
tier for free, but **commercial self-hosting needs an OpenRAIL-M license**, and the
managed API is metered. So: on-device open-weights is the default free path; any hosted
option is a user-supplied-key / opt-in setting, never on by default — same posture as the
connected-model lanes today. The commercial-license question has to be answered before
rotli *ships* Chandra self-hosted (vs. a user installing it themselves).

## Open questions

- **Does 4B-quantized Chandra actually run well via MLX** on a typical Mac / an iPad's
  Neural Engine, at usable latency? Unproven. (iPad on-device inference is the harder
  half — the Mac lane is closer.)
- **Live vs. batch:** recognize a page on demand (tap "make searchable") or silently in
  the background like the organizer? Background fits rotli's frictionless-capture ethos
  but costs compute; on-demand is safer for battery.
- **Keep ink editable?** If we re-flow to markdown, do we still let the user reopen and
  edit the strokes, or is recognition a one-way commit? (Argues for keeping the ink asset.)
- **Commercial license** terms/cost if rotli ever bundles the weights rather than having
  the user fetch them.
- **iPad app doesn't exist yet.** This whole note is downstream of that. Revisit when the
  iPad build is scoped.

---

*Nothing here is committed. If picked up, the first move is a feasibility spike: quantize
Chandra 2 for MLX and measure on-device handwriting accuracy + latency on a real Mac,
before touching the iPad.*
