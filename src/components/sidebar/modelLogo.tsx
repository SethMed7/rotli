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
    return <img className="model-logo" src={COLOR_LOGOS[logo as ColorLogoKey]} alt="" aria-hidden="true" />;
  }

  // Monochrome official marks are masks so their exact silhouettes follow
  // semantic ink in every Rotli environment and selected state.
  return <span className={`model-logo model-logo--${logo}`} aria-hidden="true" />;
}
