// The secret-egress pre-check — a TS mirror of the Rust detector
// (src-tauri/src/secret.rs). It runs in the loop BEFORE a web tool is dispatched,
// so a secret never even reaches the IPC boundary. Rust's `looks_secure` is the
// authoritative backstop on the other side; this just fails fast and locally.

const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN PGP/,
  /sk-ant-[A-Za-z0-9_-]{16}/,
  /\b(?:sk|pk|rk)_[A-Za-z0-9]{20}/,
  /github_pat_[A-Za-z0-9_]{20}/,
  /\bgh[posru]_[A-Za-z0-9]{20}/,
  /AIza[A-Za-z0-9_-]{20}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10}/,
  /whsec_[A-Za-z0-9+/]{16}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b\d{4}[ -]\d{6}[ -]\d{5}\b/,
  /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b/,
];

/** True when the text trips a high-signal secret pattern. */
export function looksSecret(text: string): boolean {
  return PATTERNS.some((re) => re.test(text));
}
