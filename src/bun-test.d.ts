// Makes `import { ... } from "bun:test"` typecheck under `tsc --noEmit`.
// We reference ONLY bun-types' test module (not its index, which pulls
// @types/node) so the app's existing @types/react auto-include is untouched
// and `bun run check` stays green with no extra runtime deps.
/// <reference types="bun-types/test" />
