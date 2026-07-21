export const SYNTAX_PATTERNS = Object.freeze({
  camelCase: /^[a-z][A-Za-z0-9]*$/,
  kebabCase: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  snakeCase: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/,
});

export function matchesSyntaxName(name, style) {
  const pattern = SYNTAX_PATTERNS[style];
  if (!pattern) throw new Error(`unknown syntax style: ${style}`);
  return pattern.test(name);
}

