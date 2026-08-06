import claudeLogo from "../../brand/providers/claude-spark-clay.svg";
import geminiLogo from "../../brand/providers/gemini.svg";
import gemmaLogo from "../../brand/providers/gemma.svg";
import qwenLogo from "../../brand/providers/qwen.svg";
import type { ChatLogoKey } from "./chatMark";

type ColorLogoKey = Exclude<ChatLogoKey, "openai">;

const COLOR_LOGOS: Record<ColorLogoKey, string> = {
  anthropic: claudeLogo,
  gemini: geminiLogo,
  gemma: gemmaLogo,
  qwen: qwenLogo,
};

/** Authentic provider/model-family art. The wrapper owns the accessible name. */
export function ModelLogo({ logo }: { logo: ChatLogoKey }) {
  if (logo === "openai") {
    // The official black Blossom is used as a mask so the exact silhouette can
    // follow readable semantic ink in every theme and on selected rows.
    return <span className="model-logo model-logo--openai" aria-hidden="true" />;
  }

  return <img className="model-logo" src={COLOR_LOGOS[logo]} alt="" aria-hidden="true" />;
}
