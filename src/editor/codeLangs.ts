// Pure language table for fenced-code highlighting — no CodeMirror imports,
// so tests (and any future surface) can reason about supported languages
// without dragging @codemirror/view's DOM-at-import requirements along.
// codeHighlight.ts owns the matching lazy parser loaders; a name listed here
// without a loader simply renders plain (safe drift, never a crash).

export const CODE_LANGS = new Set([
  "typescript",
  "javascript",
  "json",
  "python",
  "rust",
  "html",
  "css",
  "sql",
  "yaml",
  "java",
  "cpp",
  "php",
  "go",
  "bash",
  "swift",
  "ruby",
  "kotlin",
  "c",
  "toml",
  "ini",
  "dockerfile",
]);

export const CODE_LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsonc: "json",
  json5: "json",
  py: "python",
  rs: "rust",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  console: "bash",
  yml: "yaml",
  golang: "go",
  "c++": "cpp",
  h: "c",
  kt: "kotlin",
  rb: "ruby",
  xml: "html",
  vue: "html",
  scss: "css",
};

/** Normalize a fence info-string to a supported language key, or null (plain). */
export function normalizeFenceLang(info: string): string | null {
  const raw = info.trim().toLowerCase();
  if (!raw) return null;
  const lang = CODE_LANG_ALIASES[raw] ?? raw;
  return CODE_LANGS.has(lang) ? lang : null;
}
