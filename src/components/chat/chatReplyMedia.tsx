// A reply's image or video, shown in the thread (2026-09-27, Chat as a work
// surface step 1). A reply line that is only an image-style link to a vault
// file (`storage:`) renders the file: a still image, or a video with its own
// controls. Only vault files: the splitter never turns a remote address into
// media. A file that cannot be shown (missing, or outside the Mac app) keeps
// its name as plain text instead of raw Markdown.

import { useQuery } from "@tanstack/react-query";

import { extOf, fileName, IMAGE_EXTS, VIDEO_EXTS } from "../../lib/fileKind";
import { replyMediaUrl } from "../../services/chatImages";

/** @param rootPrefix the chat's vault as a wire-id prefix ("" = default vault) */
export function ChatReplyMedia({ alt, path, rootPrefix }: { alt: string; path: string; rootPrefix: string }) {
  const extension = extOf(path);
  const kind = VIDEO_EXTS.has(extension) ? "video" : IMAGE_EXTS.has(extension) ? "image" : null;
  const url = useQuery({
    queryKey: ["chat-reply-media", rootPrefix, path],
    queryFn: () => replyMediaUrl(rootPrefix, path),
    enabled: kind !== null,
    staleTime: Infinity,
  });
  const label = alt.trim() || fileName(path);
  if (kind === null || url.isError || (url.isSuccess && !url.data)) {
    return <p className="cmsg-media-missing">{label}</p>;
  }
  if (!url.data) return <div className="cmsg-media is-loading" aria-label={`Loading ${label}`} />;
  return kind === "video" ? (
    <video className="cmsg-media" src={url.data} controls preload="metadata" aria-label={label} />
  ) : (
    <img className="cmsg-media" src={url.data} alt={label} />
  );
}
