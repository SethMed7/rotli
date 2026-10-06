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
import { MAX_EDIT_ACTIONS, MAX_EDIT_TEXT } from "../documents/aiEdit";
import { DOCUMENT_CONVERTIBLE_EXTS, DOCUMENT_EDIT_MAX_BYTES } from "../documents/kinds";
import { NATIVE_IMAGE_EXTS } from "../editor/externalImageDrop";
import { AI_KEYS } from "../memex/contract";
import { stampToMs, today } from "../memex/dates";
import { SECURE_NOTES_FOLDER } from "../security/secureNotes";
import { BLOCK_MARKERS } from "../services/derive";
import { DEST } from "../services/destinations";
import { BOARD_LANE, EMPTY_BOARD_FILE } from "../services/folderBoards";
import { TEMPLATES_BRAIN_FOLDER } from "../services/templates";
import { VIEW_FOLDER_FORBIDDEN_CHARS } from "../services/viewTree";
import { SHEET_EDIT_MAX_BYTES } from "../sheets/kinds";
import { AI_CREATORS, type AiBodyEdit, bodyEdit, consentedInsertRefusal } from "./aiEditPolicy";
import { CHAT_IMAGE_ASSET_EXTS, CHAT_IMAGE_ASSET_MAX_BYTES } from "./chatWork";
import { VIDEO_EXTS } from "./fileKind";
import { PEOPLE_AREA } from "./librarianActions";
import { DEFAULT_PEOPLE_GROUPS, secureByName } from "./librarianRules";
import { type FrontmatterView, type MemexPerms, SECRET_BRAVE_SEARCH_API_KEY } from "./tauri";

const entries = fixture.entries;

describe("parity.json ↔ TS constants", () => {
  test("documentEditMaxActions", () => {
    expect(MAX_EDIT_ACTIONS).toBe(entries.documentEditMaxActions.value);
  });

  test("documentEditMaxText", () => {
    expect(MAX_EDIT_TEXT).toBe(entries.documentEditMaxText.value);
  });

  test("documentEditMaxBytes", () => {
    expect(DOCUMENT_EDIT_MAX_BYTES).toBe(entries.documentEditMaxBytes.value);
  });

  test("sheetEditMaxBytes", () => {
    expect(SHEET_EDIT_MAX_BYTES).toBe(entries.sheetEditMaxBytes.value);
  });

  test("chatImageAssetExts", () => {
    expect(CHAT_IMAGE_ASSET_EXTS).toEqual(entries.chatImageAssetExts.value);
  });

  test("chatImageAssetMaxBytes", () => {
    expect(CHAT_IMAGE_ASSET_MAX_BYTES).toBe(entries.chatImageAssetMaxBytes.value);
  });

  test("peopleArea", () => {
    expect<string>(PEOPLE_AREA).toBe(entries.peopleArea.value);
  });

  test("defaultPeopleGroups", () => {
    expect<string[]>([...DEFAULT_PEOPLE_GROUPS]).toEqual(entries.defaultPeopleGroups.value);
  });

  test("aiCreators", () => {
    expect<string[]>([...AI_CREATORS]).toEqual(entries.aiCreators.value);
  });

  test("aiBodyEditCases", () => {
    for (const c of entries.aiBodyEditCases.value) {
      expect(bodyEdit(c.fields)).toBe(c.verdict as AiBodyEdit);
    }
  });

  test("consentedInsertCases", () => {
    for (const c of entries.consentedInsertCases.value) {
      expect(consentedInsertRefusal(bodyEdit(c.fields)) !== null).toBe(c.refused);
    }
  });

  test("secureByNameCases", () => {
    for (const c of entries.secureByNameCases.value) {
      expect(secureByName(c.title, c.rel, c.keywords)).toBe(c.secure);
    }
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

  test("aiKeys", () => {
    expect<string[]>([...AI_KEYS]).toEqual(entries.aiKeys.value);
  });

  test("videoExts", () => {
    expect([...VIDEO_EXTS]).toEqual(entries.videoExts.value);
  });

  test("viewFolderForbiddenChars", () => {
    expect<string[]>([...VIEW_FOLDER_FORBIDDEN_CHARS]).toEqual(entries.viewFolderForbiddenChars.value);
  });

  test("emptyBoardScene", () => {
    expect(EMPTY_BOARD_FILE).toBe(entries.emptyBoardScene.value);
  });

  test("boardLane", () => {
    expect(BOARD_LANE).toBe(entries.boardLane.value);
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
      aiBodyEdit: true,
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

  // localMidnight is this side's own zone: the stamped day at local 00:00.
  test("noteDateStamps", () => {
    type Read = { stamp: string; fileMs?: number; expect: string; ms?: number };
    const { reads, days } = entries.noteDateStamps.value;
    for (const { stamp, fileMs, expect: kind, ms } of reads as Read[]) {
      const [y = 0, m = 1, d = 1] = stamp.trim().split("-").map(Number);
      const expected = {
        file: fileMs,
        asWritten: ms,
        localMidnight: new Date(y, m - 1, d).getTime(),
      }[kind];
      expect({ stamp, read: stampToMs(stamp, fileMs) }).toEqual({ stamp, read: expected ?? null });
    }
    for (const { nowMs, timeZone, day } of days) {
      expect({ timeZone, day: today(new Date(nowMs), timeZone) }).toEqual({ timeZone, day });
    }
  });
});
