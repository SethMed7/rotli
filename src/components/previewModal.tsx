// Quick Look (Seth, 2026-07-29): a modal PEEK at an item without opening its
// full surface — Space in the System browser or "Preview" in the row menu.
// A peek is never the workspace (the preview-catalog law stands): the Open
// button hands off to the item's real surface, and formats without a cheap
// faithful preview show an honest metadata card instead of a fake render.
// Esc / outside click close through the transient stack, like every popover.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { type Block, parseBlock, renderInline } from "../editor/render";
import { extOf, fileName } from "../lib/fileKind";
import { corpusFileText, fileAssetUrl, isTauri } from "../lib/tauri";
import { longDateLabel } from "../lib/dateLabels";
import { useTransientPopover } from "../lib/popover";
import { kindLabel } from "../services/systemBrowser";
import { notesService } from "../services/notes";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { kindOf } from "./fileSurface";
import { glyphForNote } from "./glyphs";

const TEXT_PEEK_BYTES = 64_000;

/** A tiny static markdown peek — the SAME line grammar the editor uses
 * (parseBlock + renderInline), no editing, no widgets. Faithful enough to
 * read; the full editor stays one Open away. */
function NotePeek({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  let key = 0;
  for (const line of body.split("\n")) {
    const b: Block = parseBlock(line);
    key += 1;
    if (b.kind === "blank") blocks.push(<div key={key} className="pv-blank" />);
    else if (b.kind === "h1") blocks.push(<h1 key={key}>{renderInline(b.text)}</h1>);
    else if (b.kind === "h2") blocks.push(<h2 key={key}>{renderInline(b.text)}</h2>);
    else if (b.kind === "h3") blocks.push(<h3 key={key}>{renderInline(b.text)}</h3>);
    else if (b.kind === "quote") blocks.push(<blockquote key={key}>{renderInline(b.text)}</blockquote>);
    else if (b.kind === "bullet" || b.kind === "task" || b.kind === "numbered")
      blocks.push(
        <div key={key} className="pv-li" style={{ paddingLeft: `${(b.indent ?? 0) + 1.2}em` }}>
          <span className="pv-marker">{b.kind === "numbered" ? (b.marker ?? "•") : "•"}</span>
          {renderInline(b.text)}
        </div>,
      );
    else blocks.push(<p key={key}>{renderInline(b.text)}</p>);
  }
  return <div className="pv-note">{blocks}</div>;
}

export function PreviewModal() {
  const item = useUiStore((s) => s.previewItem);
  const setPreviewItem = useUiStore((s) => s.setPreviewItem);
  const openSummary = usePanesStore((s) => s.openSummary);
  const cardRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const close = () => setPreviewItem(null);
  useTransientPopover([cardRef], item !== null, close);

  // focus lands on Open when the peek mounts and RETURNS to the opener on
  // close (DESIGN.md's focus law; Greptile, PR #2) — keyboard users can
  // escalate or dismiss without reorienting
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const isOpen = item !== null;
  useEffect(() => {
    if (isOpen) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      openBtnRef.current?.focus();
      return;
    }
    returnFocusRef.current?.focus();
    returnFocusRef.current = null;
  }, [isOpen]);

  const isFile = item?.kind === "file";
  const name = item ? (isFile ? fileName(item.id) : item.title) : "";
  const fkind = isFile ? kindOf(name) : null;

  useEffect(() => {
    setUrl(null);
    setText(null);
    setFailed(false);
    if (!item) return;
    let live = true;
    const fail = () => live && setFailed(true);
    if (item.kind === "file") {
      const k = kindOf(fileName(item.id));
      if (k === "image" || k === "pdf" || k === "audio" || k === "video") {
        void fileAssetUrl(item.id)
          .then((u) => live && (u ? setUrl(u) : setFailed(true)))
          .catch(fail);
      } else if ((k === "text" || k === "sheet") && isTauri()) {
        // csv/tsv read as text here — the peek shows the raw head; xlsx and
        // friends fall through to the metadata card (no fake render)
        const ext = extOf(fileName(item.id));
        if (k === "text" || ext === "csv" || ext === "tsv") {
          void corpusFileText(item.id, TEXT_PEEK_BYTES)
            .then((t) => live && setText(t))
            .catch(fail);
        }
      }
    } else if (item.kind !== "board") {
      void notesService
        .getNote(item.id)
        .then((n) => live && (n ? setText(n.body) : setFailed(true)))
        .catch(fail);
    }
    return () => {
      live = false;
    };
  }, [item]);

  if (!item) return null;

  const meta = `${kindLabel(item)} · ${longDateLabel(item.updatedAt)}`;
  const open = () => {
    close();
    openSummary(item);
  };

  let body: ReactNode;
  if (item.kind === "board") {
    body = <MetaCard item={item} note="Boards preview as their live canvas — open to view." />;
  } else if (!isFile) {
    body =
      text !== null ? (
        <NotePeek body={text} />
      ) : (
        <p className="pv-wait">{failed ? "Couldn’t read the note." : "Loading…"}</p>
      );
  } else if (fkind === "image" && url) {
    body = <img className="pv-media" src={url} alt={name} draggable={false} />;
  } else if (fkind === "pdf" && url) {
    body = <iframe className="pv-frame" src={url} title={name} />;
  } else if (fkind === "audio" && url) {
    body = <audio className="pv-player" controls src={url} />;
  } else if (fkind === "video" && url) {
    body = <video className="pv-media" controls src={url} />;
  } else if (text !== null) {
    body = <pre className="pv-text">{text}</pre>;
  } else if (
    (fkind === "image" || fkind === "pdf" || fkind === "audio" || fkind === "video" || fkind === "text") &&
    !failed &&
    isTauri()
  ) {
    body = <p className="pv-wait">Loading…</p>;
  } else {
    body = (
      <MetaCard
        item={item}
        note={
          isTauri()
            ? "No quick preview for this format — open it for the full surface."
            : "Previews need the app’s file access — open it instead."
        }
      />
    );
  }

  return (
    <div className="pv-scrim">
      <div className="pvw" ref={cardRef} role="dialog" aria-modal="true" aria-label={`Preview: ${name}`}>
        <header className="pv-head">
          {glyphForNote(item, { size: 15 })}
          <span className="pv-title">{name || "Empty note"}</span>
          <span className="pv-meta">{meta}</span>
          <button type="button" className="pv-open" ref={openBtnRef} onClick={open}>
            Open
          </button>
          <button type="button" className="pv-x" aria-label="Close preview — Esc" onClick={close}>
            ×
          </button>
        </header>
        <div className="pv-body">{body}</div>
      </div>
    </div>
  );
}

function MetaCard({
  item,
  note,
}: {
  item: { title: string; updatedAt: number; createdAt: number };
  note: string;
}) {
  return (
    <div className="pv-metacard">
      <p className="pv-metacard-note">{note}</p>
      <p className="pv-metacard-line">Modified {longDateLabel(item.updatedAt)}</p>
      <p className="pv-metacard-line">Created {longDateLabel(item.createdAt)}</p>
    </div>
  );
}
