// Settings → Appearance → Conversation navigator. Tesven offers its hexagon
// trail in place of the two quokka trails (state/chatNavigatorStyle.ts); the
// stored choice is never rewritten, so other themes show the person's own.

import { navigatorChoices, resolveNavigatorStyle } from "../../state/chatNavigatorStyle";
import { useDataTheme } from "../../state/theme";
import { type ChatNavigatorStyle, useUiStore } from "../../state/ui";

const NAVIGATOR_PRESENTATIONS: Record<ChatNavigatorStyle, { label: string; description: string }> = {
  lines: { label: "Quiet lines", description: "Crisp and minimal" },
  dots: { label: "Soft dots", description: "Small and steady" },
  paws: { label: "Quokka trail", description: "A path of pawprints" },
  ears: { label: "Little ears", description: "A playful landmark" },
  hexes: { label: "Hex trail", description: "Tesven's honeycomb" },
};

function NavigatorSample({ style }: { style: ChatNavigatorStyle }) {
  return (
    <span className={`navigator-sample ${style}`} aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <i className={index === 3 ? "active" : undefined} key={index}>
          {style === "paws" && (
            <>
              <b />
              <b />
              <b />
            </>
          )}
        </i>
      ))}
    </span>
  );
}

export function NavigatorSettings() {
  const dataTheme = useDataTheme();
  const stored = useUiStore((s) => s.chatNavigatorStyle);
  const setChatNavigatorStyle = useUiStore((s) => s.setChatNavigatorStyle);
  const current = resolveNavigatorStyle(stored, dataTheme);
  const tesven = dataTheme.startsWith("tesven-");
  return (
    <>
      <h4 className="sethead">Conversation navigator</h4>
      <p className="lead">
        Longer chats get a small trail that opens an overview of your prompts. Pick the quiet visual you want
        beside the conversation.
        {tesven && " Tesven trades the quokka trails for its hexagons; they come back in other themes."}
      </p>
      <div className="navigator-picker" role="radiogroup" aria-label="Conversation navigator">
        {navigatorChoices(dataTheme).map((style) => (
          <button
            type="button"
            role="radio"
            aria-checked={current === style}
            className={current === style ? "navigator-choice sel" : "navigator-choice"}
            key={style}
            onClick={() => setChatNavigatorStyle(style)}
          >
            <NavigatorSample style={style} />
            <span>
              <strong>{NAVIGATOR_PRESENTATIONS[style].label}</strong>
              <small>{NAVIGATOR_PRESENTATIONS[style].description}</small>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
