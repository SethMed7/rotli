// The images attached to a sent message: thumbnails in the bubble, a scrim
// preview on click. Asset sources resolve through the asset protocol; data,
// blob, and http(s) sources are used as they are.

import { useQueries } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useTransientPopover } from "../../lib/popover";
import { attachedImageUrl } from "../../services/chatImages";
import { XGlyph } from "../glyphs";

export function ChatAttachedImages({ images }: { images: readonly string[] }) {
  const [preview, setPreview] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useTransientPopover([dialogRef], preview !== null, () => setPreview(null));
  const resolved = useQueries({
    queries: images.map((source) => ({
      queryKey: ["chat-attached-image", source],
      queryFn: () => attachedImageUrl(source),
      staleTime: Infinity,
    })),
  });
  return (
    <>
      <div
        className="cmsg-images"
        aria-label={`${images.length} attached ${images.length === 1 ? "image" : "images"}`}
      >
        {images.map((source, index) => {
          const url = resolved[index]?.data;
          return url ? (
            <button
              type="button"
              key={`${index}-${source.slice(-16)}`}
              className="cmsg-image"
              aria-label={`Preview attached image ${index + 1}`}
              onClick={() => setPreview(url)}
            >
              <img src={url} alt={`Attached image ${index + 1}`} />
            </button>
          ) : null;
        })}
      </div>
      {preview &&
        createPortal(
          <div className="cmsg-image-scrim" role="presentation">
            <div
              ref={dialogRef}
              className="cmsg-image-dialog"
              role="dialog"
              aria-label="Attached image preview"
            >
              <button type="button" aria-label="Close image preview" onClick={() => setPreview(null)}>
                <XGlyph size={16} />
              </button>
              <img src={preview} alt="Attached image preview" />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
