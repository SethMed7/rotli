// The protection-mark grammar TypeScript and Rust share (seventh review of
// pull request 267): every case in scripts/fixtures/protection-marks.json,
// which src-tauri/src/protection_mark.rs runs too.
import { expect, test } from "bun:test";

import fixture from "../../scripts/fixtures/protection-marks.json";
import { hasSecureContext } from "../memex/contract";
import { protectionMark } from "./frontmatterBlock";

test.each(fixture.cases.map((c) => [c.name, c.contents, c.marked] as const))(
  "%s",
  (_name, contents, marked) => {
    expect(protectionMark(contents, "secureContext")).toBe(marked);
    expect(hasSecureContext(contents)).toBe(marked);
  },
);
