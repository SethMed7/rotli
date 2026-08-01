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

// UNSEPARATED card numbers (#23, audit 2026-07): "4242424242424242" has no
// dashes/spaces and skips every pattern above. A bare 15–16 digit run is too
// common to flag on shape alone, so each candidate must ALSO pass Luhn — the
// checksum every real PAN carries. Mirrors the same check in secret.rs.
const PAN = /\b\d{15,16}\b/g;

function luhnOk(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** True when the text trips a high-signal secret pattern. */
export function looksSecret(text: string): boolean {
  if (PATTERNS.some((re) => re.test(text))) return true;
  return (text.match(PAN) ?? []).some(luhnOk);
}

const PRIVATE_OVERLAP_WORDS = 5;

function proseTokens(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{2,}/gu) ?? []
  );
}

/** Detect a substantial verbatim phrase copied from locally retrieved data
 * into an off-device tool argument. This complements secret-pattern detection:
 * ordinary journals, plans, names, and business prose deserve an egress stop
 * even when they do not resemble a credential. */
export function containsPrivateDataOverlap(outbound: string, localData: readonly string[]): boolean {
  const outboundTokens = proseTokens(outbound);
  if (outboundTokens.length < PRIVATE_OVERLAP_WORDS) return false;
  const outboundPhrases = new Set<string>();
  for (let i = 0; i <= outboundTokens.length - PRIVATE_OVERLAP_WORDS; i += 1) {
    outboundPhrases.add(outboundTokens.slice(i, i + PRIVATE_OVERLAP_WORDS).join(" "));
  }
  for (const source of localData) {
    const sourceTokens = proseTokens(source);
    for (let i = 0; i <= sourceTokens.length - PRIVATE_OVERLAP_WORDS; i += 1) {
      const phrase = sourceTokens.slice(i, i + PRIVATE_OVERLAP_WORDS).join(" ");
      if (phrase.length >= 24 && outboundPhrases.has(phrase)) return true;
    }
  }
  return false;
}

/** Whether a model ENDPOINT is local to this machine (loopback host). The
 * secure-note gate derives locality from the endpoint — never from an asserted
 * flag (#2, audit 2026-07). Unparseable ⇒ false (fail closed). Rust re-derives
 * this at BOTH seams as the backstop: `corpus_read_ai` (the read) and
 * `chat_messages` (the send — a non-local endpoint refuses a secret-shaped
 * transcript even if a TS path read it locally first).
 *
 * MIRROR-NOT-IMPORT — this locality rule is written THREE times on purpose, so
 * no boundary inherits another's security policy by import:
 *   • here (the app's pre-flight check)
 *   • `src-tauri/src/chat.rs` endpoint_is_local (the Rust backstop)
 *   • `breve-runtime/scripts/config.ts` llmEndpointIsLocal (Breve's local tier)
 * The three stay in lockstep by FIXTURE, not by sharing code: the agreed
 * verdicts live in `scripts/fixtures/parity.json` → `endpointLocality`, and each
 * side asserts them independently (`src/lib/parity.test.ts`,
 * `src-tauri/src/parity_tests.rs`, `breve-runtime/tests/test-config-locality.ts`).
 * Change the rule here and you must change all three + the fixture, or one of
 * those three suites fails. */
export function endpointIsLocal(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  // http(s) only — chat.rs strips exactly these two schemes, so a non-http URL
  // ("file://localhost/x") is non-local on BOTH sides (F2)
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const h = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "::1") return true;
  // a REAL loopback IPv4 only ("127.0.0.1.evil.com" is a DNS name, not an IP)
  const m = h.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return m !== null && m.slice(1).every((o) => Number(o) <= 255);
}

/** Frontend fail-closed mirror for retrieval filtering. A localhost proxy for
 * Claude/Codex/Gemini is still frontier AI, so endpoint locality alone is not
 * enough. Rust validates the model against the registry at the read boundary. */
export function modelIsOnDevice(model: { provider: string; endpoint: string }): boolean {
  return (
    endpointIsLocal(model.endpoint) &&
    (model.provider === "mlx" || model.provider === "llamacpp" || model.provider === "ollama")
  );
}
