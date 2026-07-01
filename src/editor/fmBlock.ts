// The raw-metadata banner ("Show file metadata", Seth 2026-07-01): the note's
// frontmatter EXACTLY as it sits on disk — fences and all — rendered as an
// editable monospaced block ABOVE the body. It is a CM block widget at doc
// position 0, so it lives inside the writing column and scrolls/pushes the
// content like real file text (it IS real file text — it's just not part of
// the body buffer, which never contains frontmatter). Commit on blur / ⌘S goes
// through the guarded corpus_write_frontmatter_raw lane: Rust keeps the typed
// lines verbatim, restores id/owner/created, and refuses read-only notes.

import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

class FmBlockWidget extends WidgetType {
  constructor(
    readonly block: string,
    /** Commit COUNTER — the owner bumps it after every write attempt. A refused
     * or no-op commit re-reads the SAME block string, so without this the eq()
     * below would keep the live textarea (and its unsaved typed text) as if it
     * had saved; the bump forces a rebuild from disk truth. */
    readonly gen: number,
    /** Why the last commit was refused (read-only note, stray ---), or null. */
    readonly error: string | null,
    /** Called with the full typed text; the owner writes + re-reads disk truth. */
    readonly commit: (text: string) => void,
    /** Fresh disk truth on demand — pulled when editing STARTS, so a lock/secure
     * toggled in the panel meanwhile can't be overwritten by a stale banner. */
    readonly read: () => Promise<string>,
  ) {
    super();
  }

  override eq(other: FmBlockWidget): boolean {
    // same disk text AND same commit gen → keep the live DOM (and any
    // in-progress typing); a new disk truth OR a completed commit (even one
    // that changed nothing on disk) rebuilds the textarea from the file
    return other.block === this.block && other.gen === this.gen && other.error === this.error;
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "rotli-fm";
    // the widget sits inside CM's contenteditable content DOM — fence it off so
    // the textarea is a real form control, never part of the editable tree
    wrap.contentEditable = "false";
    const ta = document.createElement("textarea");
    ta.className = "rotli-fm-text";
    ta.value = this.block;
    // an initial row guess (the resize below measures the real height on mount)
    ta.rows = Math.max(1, this.block.trimEnd().split("\n").length);
    ta.placeholder = "---\nkey: value\n---";
    ta.spellcheck = false;
    ta.setAttribute("aria-label", "File metadata (raw frontmatter)");
    // grow like text, never scroll inside itself — the note scrolls as one page
    const resize = () => {
      ta.style.height = "0px";
      ta.style.height = `${ta.scrollHeight}px`;
    };
    ta.addEventListener("input", resize);
    requestAnimationFrame(resize);
    // the change baseline: this widget's block at build, refreshed from disk the
    // moment editing starts (focus) while the text is still untouched
    let baseline = this.block;
    ta.addEventListener("focus", () => {
      void this.read().then((fresh) => {
        if (ta.value === baseline && fresh !== baseline) {
          ta.value = fresh;
          baseline = fresh;
          resize();
        }
      });
    });
    const commitIfChanged = () => {
      if (ta.value !== baseline) this.commit(ta.value);
    };
    ta.addEventListener("keydown", (e) => {
      // the textarea owns its keys — nothing leaks to the CM keymaps or the
      // window dispatcher (Esc must not hide the app, ⌘S commits here)
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        commitIfChanged();
      } else if (e.key === "Escape") {
        // Esc CANCELS (the universal convention — the sheet editor's cell
        // input matches): revert to the baseline so the blur commit is a no-op
        ta.value = baseline;
        resize();
        ta.blur();
      }
    });
    ta.addEventListener("blur", commitIfChanged);
    wrap.appendChild(ta);
    if (this.error) {
      // the refused commit must be VISIBLE — the textarea just snapped back to
      // disk truth, and a silent revert reads as "saved" (2026-07-01 review)
      const err = document.createElement("div");
      err.className = "rotli-fm-err";
      err.setAttribute("role", "alert");
      err.textContent = `⚠ metadata not saved — ${this.error}`;
      wrap.appendChild(err);
    }
    return wrap;
  }

  override ignoreEvent(): boolean {
    return true; // the textarea handles everything itself
  }
}

/** The banner as a CM extension — a block widget pinned above the first line.
 * Static facet value (block decorations may not come from view plugins); the
 * caller reconfigures its compartment whenever the disk block changes, a
 * commit completes (`gen` bumps), or a refusal message arrives. */
export function fmBlock(
  block: string,
  gen: number,
  error: string | null,
  commit: (text: string) => void,
  read: () => Promise<string>,
): Extension {
  return EditorView.decorations.of(
    Decoration.set([
      Decoration.widget({
        widget: new FmBlockWidget(block, gen, error, commit, read),
        side: -1,
        block: true,
      }).range(0),
    ]),
  );
}
