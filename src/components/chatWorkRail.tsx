import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { type ChatWorkItem, type ChatWorkKind } from "../lib/chatWork";
import { extOf } from "../lib/fileKind";
import { fileAssetUrl } from "../lib/tauri";

type WorkFilter = "all" | ChatWorkKind;

function WorkFileGlyph({ image }: { image: boolean }) {
  return image ? (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1.4" />
      <circle cx="5.4" cy="6" r="1" />
      <path d="m2.6 12 3.8-3.6 2.5 2.2 2.1-1.9 2.4 2.2" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <path d="M4 1.8h5.4L13 5.4v8.8H4a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1Z" />
      <path d="M9.4 1.8v3.6H13M5.3 8.3h5.4M5.3 10.8h5.4" />
    </svg>
  );
}

function WorkThumb({ item }: { item: ChatWorkItem }) {
  const url = useQuery({
    queryKey: ["chat-work-thumb", item.id],
    queryFn: () => fileAssetUrl(item.id),
    enabled: item.kind === "image",
  });
  if (item.kind === "image" && url.data) return <img src={url.data} alt="" />;
  return (
    <span className="chat-work-file-glyph">
      <WorkFileGlyph image={item.kind === "image"} />
    </span>
  );
}

function filterLabel(filter: WorkFilter): string {
  if (filter === "image") return "Images";
  if (filter === "artifact") return "Artifacts";
  return "All";
}

export function ChatWorkRail({
  items,
  openedId,
  collapsed,
  onOpen,
  onUse,
  onExpand,
}: {
  items: readonly ChatWorkItem[];
  openedId: string | null;
  collapsed: boolean;
  onOpen: (item: ChatWorkItem) => void;
  onUse: (item: ChatWorkItem) => void;
  onExpand: () => void;
}) {
  const [filter, setFilter] = useState<WorkFilter>("all");
  const imageCount = items.filter((item) => item.kind === "image").length;
  const artifactCount = items.length - imageCount;
  const visible = filter === "all" ? items : items.filter((item) => item.kind === filter);

  return (
    <aside className={collapsed ? "chat-work-rail is-collapsed" : "chat-work-rail"} aria-label="Chat work">
      <div className="chat-work-panel">
        <div className="chat-work-head">
          <h3>Work</h3>
          <span>{items.length}</span>
        </div>
        <div className="chat-work-tabs" role="tablist" aria-label="Chat work filter">
          {(["all", "image", "artifact"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? "is-active" : ""}
              onClick={() => setFilter(value)}
            >
              {filterLabel(value)}
            </button>
          ))}
        </div>
        <div className="chat-work-list">
          {visible.length === 0 ? (
            <div className="chat-work-empty">
              {items.length === 0
                ? "Attached images and files created in this chat will appear here."
                : `No ${filterLabel(filter).toLowerCase()} in this chat yet.`}
            </div>
          ) : (
            visible.map((item) => (
              <div key={item.id} className="chat-work-entry">
                <button
                  type="button"
                  className={item.id === openedId ? "chat-work-row is-open" : "chat-work-row"}
                  aria-label={`Open ${item.name} to the right`}
                  onClick={() => onOpen(item)}
                >
                  <span className="chat-work-thumb">
                    <WorkThumb item={item} />
                  </span>
                  <span className="chat-work-copy">
                    <span className="chat-work-name">{item.name}</span>
                    <span className="chat-work-meta">
                      {item.kind === "image"
                        ? "Image"
                        : item.surfaceKind === "note"
                          ? "Markdown"
                          : item.surfaceKind === "canvas"
                            ? "Board"
                            : extOf(item.name).toUpperCase() || "File"}
                      {item.source === "attachment" ? " · Attached" : " · Created here"}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="chat-work-use"
                  aria-label={`Use ${item.name} in chat`}
                  title="Use in chat"
                  onClick={() => onUse(item)}
                >
                  Use
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="chat-work-launcher">
        <button type="button" title={`${imageCount} images — show Work`} onClick={onExpand}>
          <WorkFileGlyph image />
          <span>{imageCount}</span>
        </button>
        <button type="button" title={`${artifactCount} artifacts — show Work`} onClick={onExpand}>
          <WorkFileGlyph image={false} />
          <span>{artifactCount}</span>
        </button>
      </div>
    </aside>
  );
}
