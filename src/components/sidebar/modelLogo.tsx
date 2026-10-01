import type { CSSProperties } from "react";

import claudeLogo from "../../brand/providers/claude-spark-clay.svg";
import geminiLogo from "../../brand/providers/gemini.svg";
import gemmaLogo from "../../brand/providers/gemma.svg";
import qwenLogo from "../../brand/providers/qwen.svg";
import type { ChatLogoKey } from "./chatMark";

type ColorLogoKey = Extract<ChatLogoKey, "anthropic" | "gemini" | "gemma" | "qwen">;

const COLOR_LOGOS: Record<ColorLogoKey, string> = {
  anthropic: claudeLogo,
  gemini: geminiLogo,
  gemma: gemmaLogo,
  qwen: qwenLogo,
};

/** Authentic provider/model-family art. The wrapper owns the accessible name. */
export function ModelLogo({ logo }: { logo: ChatLogoKey }) {
  if (logo in COLOR_LOGOS) {
    const src = COLOR_LOGOS[logo as ColorLogoKey];
    // the same mark as a mask too: the sidebar's Neutral icons show it in ink
    // instead of its colors (notes.css, [data-icons="neutral"])
    return (
      <>
        <img className="model-logo model-logo-color" src={src} alt="" aria-hidden="true" />
        <span
          className="model-logo model-logo-ink"
          style={{ "--logo": `url("${src}")` } as CSSProperties}
          aria-hidden="true"
        />
      </>
    );
  }

  // Monochrome official marks are masks so their exact silhouettes follow
  // semantic ink in every Rotli environment and selected state.
  return <span className={`model-logo model-logo--${logo}`} aria-hidden="true" />;
}
