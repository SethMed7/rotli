/** Product-owned CSS stays flat and consumes semantic color roles.
 * Vendor styles are outside this policy; src/styles is not. */
export function flatCssViolations(source, file) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const violations = [];
  const effectDeclaration =
    /(?:^|[;{])\s*((?:-webkit-)?backdrop-filter|box-shadow|text-shadow|filter)\s*:/gim;

  for (const match of css.matchAll(effectDeclaration)) {
    violations.push(`${file}: ${match[1]} is forbidden; use surfaces, borders, and outlines`);
  }
  if (/--[a-z0-9-]*(?:glow|halo|shadow)[a-z0-9-]*\s*:/i.test(css)) {
    violations.push(`${file}: glow, halo, and shadow tokens are forbidden`);
  }
  if (/(?:repeating-)?radial-gradient\s*\(/i.test(css)) {
    violations.push(`${file}: radial gradients are forbidden; use a solid semantic surface or scrim`);
  }
  // A hidden window must stay parked. `running` is the CSS default, so writing
  // it can only mean overriding base.css's idle pause — which would let an
  // animation composite while nobody can see it (the Tauri idle-CPU bug).
  if (/animation-play-state\s*:\s*running/i.test(css)) {
    violations.push(`${file}: animation-play-state:running defeats the idle pause in base.css`);
  }
  if (file !== "src/styles/base.css" && file !== "src/styles/themes.css" && /var\(--rotli-/i.test(css)) {
    violations.push(`${file}: product CSS must consume semantic roles, not fixed --rotli-* palette tokens`);
  }

  return violations;
}
