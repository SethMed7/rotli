// Settings → Appearance → Chat buddy. The quokka in Chat is always there; the
// person decorates it here (body color, lines, accessory and its hue) and
// watches it change live. Its pose is never a choice: Chat picks the
// expression for the moment (chat/chatBuddyModel.ts), shown below as a strip
// wearing the same decoration.

import type { CSSProperties } from "react";

import {
  QUOKKA_ACCESSORY_PRESENTATIONS,
  QUOKKA_LINE_COLORS,
  QUOKKA_STYLE_PRESENTATIONS,
  type QuokkaLineColor,
  quokkaAccessoryColor,
  quokkaCustomColor,
} from "../../brand/quokka";
import { useUiStore } from "../../state/ui";
import { Character, type CharacterName } from "../character";

/** The three line-colour choices, named honestly: Auto follows the theme. */
const QUOKKA_LINE_COLOR_LABEL: Record<QuokkaLineColor, string> = {
  auto: "Auto",
  black: "Black",
  white: "White",
};

/** The moments the buddy shows in Chat, in the order a reply goes. */
const BUDDY_MOMENTS = [
  ["waving", "Hello"],
  ["thoughtful", "Thinking"],
  ["celebrating", "Done"],
  ["listening", "Listening"],
] as const satisfies readonly (readonly [CharacterName, string])[];

export function ChatBuddyStudio() {
  const quokkaStyle = useUiStore((s) => s.quokkaStyle);
  const setQuokkaStyle = useUiStore((s) => s.setQuokkaStyle);
  const quokkaCustomHue = useUiStore((s) => s.quokkaCustomHue);
  const setQuokkaCustomHue = useUiStore((s) => s.setQuokkaCustomHue);
  const quokkaLineColor = useUiStore((s) => s.quokkaLineColor);
  const setQuokkaLineColor = useUiStore((s) => s.setQuokkaLineColor);
  const quokkaAccessory = useUiStore((s) => s.quokkaAccessory);
  const setQuokkaAccessory = useUiStore((s) => s.setQuokkaAccessory);
  const quokkaAccessoryHue = useUiStore((s) => s.quokkaAccessoryHue);
  const setQuokkaAccessoryHue = useUiStore((s) => s.setQuokkaAccessoryHue);
  return (
    <>
      <h4 className="sethead" id="appearance-quokka-title">
        Chat buddy
      </h4>
      <p className="lead">
        A quokka keeps you company in every chat and picks its own expression as the conversation goes.
        Decorate it here; the compact product mark always stays its original line drawing.
      </p>
      <section className="quokka-studio" aria-labelledby="appearance-quokka-title">
        <div className="quokka-studio-preview" data-testid="chat-buddy-preview">
          <Character name="chat" size={148} />
          <span>
            <strong>
              {QUOKKA_STYLE_PRESENTATIONS.find((choice) => choice.style === quokkaStyle)?.label ?? "Cocoa"}
            </strong>
            <small>
              {QUOKKA_ACCESSORY_PRESENTATIONS.find((choice) => choice.accessory === quokkaAccessory)
                ?.description ?? "Just the quokka"}{" "}
              · {QUOKKA_LINE_COLOR_LABEL[quokkaLineColor]} lines
            </small>
          </span>
        </div>

        <div className="quokka-studio-controls">
          <fieldset>
            <legend>Body color</legend>
            <div className="quokka-swatches" role="radiogroup" aria-label="Quokka body color">
              {QUOKKA_STYLE_PRESENTATIONS.map((choice) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={quokkaStyle === choice.style}
                  aria-label={`${choice.label}: ${choice.description}`}
                  className={
                    quokkaStyle === choice.style
                      ? `quokka-swatch ${choice.style} sel`
                      : `quokka-swatch ${choice.style}`
                  }
                  key={choice.style}
                  style={
                    choice.style === "line"
                      ? undefined
                      : ({
                          "--quokka-choice-color": choice.color ?? quokkaCustomColor(quokkaCustomHue),
                        } as CSSProperties)
                  }
                  onClick={() => setQuokkaStyle(choice.style)}
                >
                  <span aria-hidden="true" />
                  <small>{choice.label}</small>
                </button>
              ))}
            </div>
            {quokkaStyle === "custom" && (
              <label
                className="quokka-custom-hue"
                style={{ "--quokka-custom-color": quokkaCustomColor(quokkaCustomHue) } as CSSProperties}
              >
                <span>Hue {quokkaCustomHue}°</span>
                <input
                  type="range"
                  min="0"
                  max="359"
                  value={quokkaCustomHue}
                  aria-label="Custom quokka body color hue"
                  onChange={(event) => setQuokkaCustomHue(Number(event.currentTarget.value))}
                />
              </label>
            )}
          </fieldset>

          <fieldset>
            <legend>Line color</legend>
            <div className="quokka-line-colors" role="radiogroup" aria-label="Quokka line color">
              {QUOKKA_LINE_COLORS.map((color) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={quokkaLineColor === color}
                  className={
                    quokkaLineColor === color
                      ? `quokka-line-choice ${color} sel`
                      : `quokka-line-choice ${color}`
                  }
                  key={color}
                  onClick={() => setQuokkaLineColor(color)}
                >
                  <span aria-hidden="true" />
                  {QUOKKA_LINE_COLOR_LABEL[color]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Accessory</legend>
            <div className="quokka-accessories" role="radiogroup" aria-label="Quokka accessory">
              {QUOKKA_ACCESSORY_PRESENTATIONS.map((choice) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={quokkaAccessory === choice.accessory}
                  className={
                    quokkaAccessory === choice.accessory ? "quokka-accessory sel" : "quokka-accessory"
                  }
                  key={choice.accessory}
                  onClick={() => setQuokkaAccessory(choice.accessory)}
                >
                  <Character name="base" size={48} accessory={choice.accessory} />
                  <span>
                    <strong>{choice.label}</strong>
                    <small>{choice.description}</small>
                  </span>
                </button>
              ))}
            </div>
            {quokkaAccessory !== "none" && quokkaStyle !== "line" && (
              <label
                className="quokka-accessory-hue"
                style={
                  {
                    "--quokka-accessory-color": quokkaAccessoryColor(quokkaAccessoryHue),
                  } as CSSProperties
                }
              >
                <span>Accessory hue {quokkaAccessoryHue}°</span>
                <input
                  type="range"
                  min="0"
                  max="359"
                  value={quokkaAccessoryHue}
                  aria-label="Quokka accessory color hue"
                  onChange={(event) => setQuokkaAccessoryHue(Number(event.currentTarget.value))}
                />
              </label>
            )}
          </fieldset>
        </div>
      </section>

      <span className="setsubhead">Expressions it picks in Chat</span>
      <div className="quokka-expression-strip" aria-label="Automatic quokka expressions">
        {BUDDY_MOMENTS.map(([name, label]) => (
          <span key={name}>
            <Character name={name} size={64} />
            <small>{label}</small>
          </span>
        ))}
      </div>
    </>
  );
}
