// Semantic tokens resolved to colors a <canvas> can paint. A canvas can't read
// `var(--accent)`, and a token's raw text may be color-mix() or another var(),
// so each token is resolved through a hidden probe's computed color. Shared by
// the onboarding banner and the Graph view (2026-10-05) — one resolver.

function resolveTokenColors<K extends string>(
  tokens: Record<K, string>,
  within: Element = document.body,
): Record<K, string> {
  const probe = document.createElement("span");
  probe.style.display = "none";
  within.append(probe);
  const colors = {} as Record<K, string>;
  for (const key of Object.keys(tokens) as K[]) {
    probe.style.color = `var(${tokens[key]})`;
    colors[key] = getComputedStyle(probe).color;
  }
  probe.remove();
  return colors;
}

/** The roles every canvas painter draws with: ground, ink, quiet ink, accent,
 * and a hairline. One map, so a new painter can't pick a different token. */
export function canvasColors(
  within?: Element,
): Record<"ground" | "accent" | "text" | "muted" | "line", string> {
  return resolveTokenColors(
    {
      ground: "--ground",
      accent: "--accent",
      text: "--text",
      muted: "--text-muted",
      line: "--border-strong",
    },
    within,
  );
}
