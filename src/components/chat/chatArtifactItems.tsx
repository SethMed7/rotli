// The files a chat made, as the artifacts rail and the reply's inline chips
// show them (split out of chatSurface.tsx, 2026-09-27, when video became a
// type of its own). Images carry a thumbnail; a video, a Word document, a
// note, and a board carry their marks; anything else is a plain file.

import { useQuery } from "@tanstack/react-query";

import { DOCUMENT_EXTS, WORD_EXTS } from "../../documents/kinds";
import { extOf, fileName, IMAGE_EXTS, VIDEO_EXTS } from "../../lib/fileKind";
import type { ChatArtifact } from "../../memex/contract";
import { attachedImageUrl } from "../../services/chatImages";
import { BoardGlyph, DocumentGlyph, ImageGlyph, WordGlyph } from "../glyphs";

/** A film frame with a play mark (glyphs.tsx sits at its size ceiling). */
function VideoGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 9.5v5l4.2-2.5z" />
    </svg>
  );
}

export type ArtifactType = "image" | "video" | "word" | "document" | "note" | "board" | "file";

export function artifactType(artifact: ChatArtifact): ArtifactType {
  if (artifact.kind === "note") return "note";
  if (artifact.kind === "canvas") return "board";
  const extension = extOf(artifact.id);
  if (IMAGE_EXTS.has(extension)) return "image";
  if (VIDEO_EXTS.has(extension)) return "video";
  if (WORD_EXTS.has(extension)) return "word";
  if (DOCUMENT_EXTS.has(extension)) return "document";
  return "file";
}

function artifactName(artifact: ChatArtifact): string {
  return artifact.label ?? fileName(artifact.id).replace(/-\d{13}(?=\.[^.]+$)/, "");
}

/** One chat-created artifact. Images carry a real thumbnail; conventional
 * files use the same quiet format marks as tabs and the System browser. */
export function ArtifactItem({ artifact, onOpen }: { artifact: ChatArtifact; onOpen: () => void }) {
  const type = artifactType(artifact);
  const url = useQuery({
    queryKey: ["asset-url", artifact.id],
    queryFn: () => attachedImageUrl(artifact.id),
    enabled: type === "image",
  });
  const name = fileName(artifact.id);
  return (
    <button type="button" className="chat-artifact" title={`Open ${name}`} onClick={onOpen}>
      <span className={`chat-artifact-preview ${type}`}>
        {type === "image" && url.data ? (
          <img src={url.data} alt="" />
        ) : type === "image" ? (
          <ImageGlyph size={18} />
        ) : type === "video" ? (
          <VideoGlyph />
        ) : type === "word" ? (
          <WordGlyph size={22} />
        ) : type === "document" ? (
          <DocumentGlyph size={18} />
        ) : type === "note" ? (
          <DocumentGlyph size={18} />
        ) : type === "board" ? (
          <BoardGlyph size={18} />
        ) : (
          <DocumentGlyph size={18} />
        )}
      </span>
      <span className="chat-artifact-copy">
        <strong>{artifactName(artifact)}</strong>
        <small>
          {type === "word"
            ? `Microsoft Word · ${extOf(name).toUpperCase()}`
            : type === "note"
              ? "Editable Markdown source"
              : type === "board"
                ? "Board"
                : type === "video"
                  ? `Video · ${extOf(name).toUpperCase()}`
                  : extOf(name).toUpperCase() || "File"}
        </small>
      </span>
    </button>
  );
}

/** Conventional files remain visible in the transcript itself as ordinary
 * click targets. The rail is the complete artifact browser; this compact row
 * keeps the file promised by the assistant next to the conversation that made
 * it without forcing the file open. */
export function ChatArtifactButtons({
  artifacts,
  onOpen,
}: {
  artifacts: ChatArtifact[];
  onOpen: (artifact: ChatArtifact) => void;
}) {
  const files = artifacts
    .filter((artifact) => {
      const type = artifactType(artifact);
      return type === "word" || type === "document" || type === "note";
    })
    .reverse();
  if (files.length === 0) return null;
  return (
    <div className="chat-inline-artifacts" aria-label="Documents created in this chat">
      {files.map((artifact) => {
        const type = artifactType(artifact);
        const name = artifactName(artifact);
        return (
          <button
            key={`${artifact.kind}:${artifact.id}`}
            type="button"
            className={`chat-inline-artifact ${type}`}
            title={`Open ${name}`}
            onClick={() => onOpen(artifact)}
          >
            <span className="chat-inline-artifact-icon">
              {type === "word" ? <WordGlyph size={22} /> : <DocumentGlyph size={19} />}
            </span>
            <span className="chat-inline-artifact-copy">
              <strong>{name}</strong>
              <small>
                {type === "word"
                  ? "Microsoft Word document"
                  : type === "note"
                    ? "Editable Markdown source"
                    : "Document"}
              </small>
            </span>
            <span className="chat-inline-artifact-open" aria-hidden="true">
              Open
            </span>
          </button>
        );
      })}
    </div>
  );
}
