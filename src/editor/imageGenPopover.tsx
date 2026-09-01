// /image-gen is retained as an honest unavailable state while connected cloud
// providers are paused. The native command independently refuses execution.

/** No subscription-authenticated image engine may be offered, even when stale
 * settings and a locally installed CLI both claim it is ready. */
export function readyImageEngines(): never[] {
  return [];
}

/** The inserted markdown for a finished generation. Pure — exported for tests.
 * The alt is the prompt, flattened and clipped so the line stays readable; the
 * src uses the `storage:` shorthand every other note image speaks. */
export function imageGenMarkdown(prompt: string, rel: string): string {
  const alt = prompt
    .replace(/\s+/g, " ")
    .replace(/[[\]()]/g, "")
    .trim()
    .slice(0, 80);
  const src = rel.replace(/^storage\//i, "");
  return `![${alt}](storage:${src})\n`;
}

export function ImageGenPopover({
  onDone: _onDone,
  onClose,
}: {
  /** Insert the finished image's markdown at the slash point. */
  onDone: (markdown: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="rotli-imagegen"
      role="dialog"
      aria-label="Generate image"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="rotli-imagegen-empty">
        Cloud image generation is unavailable until Rotli ships a provider-authorized API integration. Your
        existing images remain in the vault.
      </p>
      <div className="rotli-imagegen-row">
        <span className="rotli-imagegen-note">No provider account will be used.</span>
        <button type="button" className="rotli-imagegen-cancel" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
