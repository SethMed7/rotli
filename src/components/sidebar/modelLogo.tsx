import claudeLogo from "../../brand/providers/claude-spark-clay.svg";
import geminiLogo from "../../brand/providers/gemini.svg";
import gemmaLogo from "../../brand/providers/gemma.svg";
import metaLogo from "../../brand/providers/meta.svg";
import microsoftLogo from "../../brand/providers/microsoft.svg";
import mistralLogo from "../../brand/providers/mistral.svg";
import openaiWhiteLogo from "../../brand/providers/openai-blossom-white.svg";
import openaiBlackLogo from "../../brand/providers/openai-blossom.svg";
import qwenLogo from "../../brand/providers/qwen.svg";
import { useIsDarkTheme } from "../../state/theme";
import type { ChatLogoKey } from "./chatMark";

/** Each vendor's own artwork, in the vendor's own colors. OpenAI publishes
 * its Blossom only in black and white, so it is the one mark with a light and
 * a dark file; every other mark is a single full-color file. */
const LOGOS: Record<ChatLogoKey, { light: string; dark: string }> = {
  anthropic: { light: claudeLogo, dark: claudeLogo },
  openai: { light: openaiBlackLogo, dark: openaiWhiteLogo },
  gemini: { light: geminiLogo, dark: geminiLogo },
  gemma: { light: gemmaLogo, dark: gemmaLogo },
  qwen: { light: qwenLogo, dark: qwenLogo },
  meta: { light: metaLogo, dark: metaLogo },
  microsoft: { light: microsoftLogo, dark: microsoftLogo },
  mistral: { light: mistralLogo, dark: mistralLogo },
};

/** The file a vendor mark renders from in a light or dark environment. */
export function modelLogoSrc(logo: ChatLogoKey, dark: boolean): string {
  return dark ? LOGOS[logo].dark : LOGOS[logo].light;
}

/** Authentic provider/model-family art. The wrapper owns the accessible name.
 * A vendor's mark keeps its own colors everywhere — every theme family, the
 * selected row, the sidebar's Neutral icons — and never takes Rotli's ink: it
 * is there to say who answers, and in one ink every model looked alike (the
 * owner, 2026-10-10 and 2026-10-15). */
export function ModelLogo({ logo }: { logo: ChatLogoKey }) {
  const dark = useIsDarkTheme();
  return (
    <img
      className={`model-logo model-logo--${logo}`}
      src={modelLogoSrc(logo, dark)}
      alt=""
      aria-hidden="true"
    />
  );
}
