// Rotli login-keychain coordinates — byte-identical to src-tauri/src/keychain.rs
// (SERVICE / BREVE_RESEND_ACCOUNT). Guarded by scripts/fixtures/parity.json +
// src/lib/parity.test.ts + src-tauri/src/parity_tests.rs; change both sides.
// Pure module (no Bun/node imports) so app-side tests can import it directly.

export const ROTLI_KEYCHAIN_SERVICE = "rotli";
export const ROTLI_RESEND_ACCOUNT = "breve-resend-api-key";
