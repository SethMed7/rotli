// TS↔Rust parity assertions — hand-written, never generated. The contract is
// scripts/fixtures/parity.json; src-tauri/src/parity_tests.rs asserts the same
// entries against the Rust constants, and scripts/check-parity.mjs keeps every
// fixture entry referenced by BOTH suites (each test below is named after its
// entry key). endpointLocality is behavioral: both sides run the same URLs
// through their own independent implementation.

import { describe, expect, test } from "bun:test";

import {
  CLAUDE_BIN_CANDIDATES,
  CODEX_BIN_CANDIDATES,
  CURSOR_BIN_CANDIDATES,
  ANTIGRAVITY_BIN_CANDIDATES,
} from "../../breve-runtime/scripts/cli-paths";
import { ROTLI_KEYCHAIN_SERVICE, ROTLI_RESEND_ACCOUNT } from "../../breve-runtime/scripts/keychain-names";
import fixture from "../../scripts/fixtures/parity.json";
import { containsPrivateDataOverlap, endpointIsLocal } from "../ai/guard";
import { BOARD_LIMITS } from "../boards/validation";
import { DOCUMENT_CONVERTIBLE_EXTS } from "../documents/kinds";
import { NATIVE_IMAGE_EXTS } from "../editor/externalImageDrop";
import { SECURE_NOTES_FOLDER } from "../security/secureNotes";
import { BLOCK_MARKERS } from "../services/derive";
import { DEST } from "../services/destinations";
import { TEMPLATES_BRAIN_FOLDER } from "../services/templates";
import { SHEET_EDIT_MAX_BYTES } from "../sheets/kinds";
import { CHAT_IMAGE_ASSET_EXTS, CHAT_IMAGE_ASSET_MAX_BYTES } from "./chatWork";
import { VIDEO_EXTS } from "./fileKind";
import { type FrontmatterView, type MemexPerms, SECRET_BRAVE_SEARCH_API_KEY } from "./tauri";

const entries = fixture.entries;

describe("parity.json ↔ TS constants", () => {
  test("sheetEditMaxBytes", () => {
    expect(SHEET_EDIT_MAX_BYTES).toBe(entries.sheetEditMaxBytes.value);
  });

  test("chatImageAssetExts", () => {
    expect(CHAT_IMAGE_ASSET_EXTS).toEqual(entries.chatImageAssetExts.value);
  });

  test("chatImageAssetMaxBytes", () => {
    expect(CHAT_IMAGE_ASSET_MAX_BYTES).toBe(entries.chatImageAssetMaxBytes.value);
  });

  test("secureNotesFolder", () => {
    expect<string>(SECURE_NOTES_FOLDER).toBe(entries.secureNotesFolder.value);
    expect<string>(DEST.secure).toBe(entries.secureNotesFolder.value);
  });

  test("stripMarkers", () => {
    expect<string[]>([...BLOCK_MARKERS]).toEqual(entries.stripMarkers.value);
  });

  test("nativeImagePickerExts", () => {
    expect([...NATIVE_IMAGE_EXTS]).toEqual(entries.nativeImagePickerExts.value);
  });

  test("templatesBrainFolder", () => {
    expect<string>(TEMPLATES_BRAIN_FOLDER).toBe(entries.templatesBrainFolder.value);
  });

  test("videoExts", () => {
    expect([...VIDEO_EXTS]).toEqual(entries.videoExts.value);
  });

  test("boardLimits", () => {
    const limits: Record<string, number> = { ...BOARD_LIMITS };
    expect(limits).toEqual(entries.boardLimits.value);
  });

  test("documentConvertibleExts", () => {
    const exts: string[] = [...DOCUMENT_CONVERTIBLE_EXTS];
    expect(exts).toEqual(entries.documentConvertibleExts.value);
  });

  test("memexPerms", () => {
    // compile-time half: adding/removing a MemexPerms member breaks this literal
    const perms: Record<MemexPerms, true> = { "chats+inbox": true, "read-only": true };
    expect(Object.keys(perms).sort()).toEqual([...entries.memexPerms.value].sort());
  });

  test("frontmatterView", () => {
    // compile-time half: a FrontmatterView field change breaks this literal;
    // the Rust twin asserts the struct's serde wire keys against the same fixture
    const keys: Record<keyof FrontmatterView, true> = {
      id: true,
      created: true,
      updated: true,
      locked: true,
      secure: true,
      localAiAllowed: true,
      pinned: true,
      fields: true,
    };
    expect(Object.keys(keys).sort()).toEqual([...entries.frontmatterView.value].sort());
  });

  test("keychainService", () => {
    expect(ROTLI_KEYCHAIN_SERVICE).toBe(entries.keychainService.value);
  });

  test("keychainAllowedAccounts", () => {
    expect(entries.keychainAllowedAccounts.value).toEqual([
      SECRET_BRAVE_SEARCH_API_KEY,
      ROTLI_RESEND_ACCOUNT,
    ]);
  });

  test("cliBinCandidates", () => {
    const claude: string[] = [...CLAUDE_BIN_CANDIDATES];
    const codex: string[] = [...CODEX_BIN_CANDIDATES];
    const cursor: string[] = [...CURSOR_BIN_CANDIDATES];
    expect(claude).toEqual(entries.cliBinCandidates.value.claude);
    expect(codex).toEqual(entries.cliBinCandidates.value.codex);
    expect(cursor).toEqual(entries.cliBinCandidates.value.cursor);
    const antigravity: string[] = [...ANTIGRAVITY_BIN_CANDIDATES];
    expect(antigravity).toEqual(entries.cliBinCandidates.value.antigravity);
  });

  test("secureOverlap", () => {
    const { source, matches, clean } = entries.secureOverlap.value;
    for (const outbound of matches) {
      expect({ outbound, overlaps: containsPrivateDataOverlap(outbound, [source]) }).toEqual({
        outbound,
        overlaps: true,
      });
    }
    for (const outbound of clean) {
      expect({ outbound, overlaps: containsPrivateDataOverlap(outbound, [source]) }).toEqual({
        outbound,
        overlaps: false,
      });
    }
  });

  test("endpointLocality", () => {
    for (const { url, local } of entries.endpointLocality.value) {
      // compare {url, verdict} pairs so a failure names the offending URL
      expect({ url, local: endpointIsLocal(url) }).toEqual({ url, local });
    }
  });
});
