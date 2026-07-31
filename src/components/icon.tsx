// Kit icon component. Injects the frozen sprite once (vite ?raw) and renders
// <use> references. The sprite's fixed accent attributes (clay / olive) are
// rewritten to CSS vars at injection time — the values are read from the kit's
// own tokens, never hardcoded here — so the icons README context rules apply:
// dark grounds lift olive to --rotli-olive-bright, and any `.icon-mono`
// ancestor forces accents to currentColor.

import spriteRaw from "../brand/icons/rotli-icons.sprite.svg?raw";

export type RotliIconName =
  | "rotli-notes"
  | "rotli-chat"
  | "rotli-voice"
  | "rotli-memory"
  | "rotli-inbox"
  | "rotli-board"
  | "rotli-capture"
  | "rotli-tags"
  | "rotli-search"
  | "rotli-sync"
  | "rotli-settings";

let injected = false;

function ensureSprite(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;

  const host = document.createElement("div");
  host.innerHTML = spriteRaw;
  const svg = host.querySelector("svg");
  if (!svg) return;

  // Hex compare must be case-insensitive: the sprite freezes uppercase
  // attributes while the tokens are authored lowercase.
  const tokens = getComputedStyle(document.documentElement);
  const clay = tokens.getPropertyValue("--rotli-clay").trim().toLowerCase();
  const olive = tokens.getPropertyValue("--rotli-olive").trim().toLowerCase();

  for (const el of svg.querySelectorAll<SVGElement>("[stroke], [fill]")) {
    for (const attr of ["stroke", "fill"] as const) {
      const value = el.getAttribute(attr)?.toLowerCase();
      if (value === clay) el.style.setProperty(attr, "var(--icon-clay)");
      else if (value === olive) el.style.setProperty(attr, "var(--icon-olive)");
    }
  }

  document.body.prepend(svg);
}

interface IconProps {
  name: RotliIconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 15, className }: IconProps) {
  ensureSprite();
  return (
    <svg className={className ? `icon ${className}` : "icon"} width={size} height={size} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}
