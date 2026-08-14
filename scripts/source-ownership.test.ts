import { describe, expect, test } from "bun:test";

import {
  COMPONENT_DIRECTORY_OWNERS,
  COMPONENT_ROOT_FILE_OWNERS,
  SERVICE_FILE_OWNERS,
  SOURCE_DIRECTORY_OWNERS,
  SOURCE_ROOT_FILE_OWNERS,
  sourceOwnershipViolations,
} from "./source-ownership";

const completeSnapshot = () => ({
  sourceDirectories: Object.keys(SOURCE_DIRECTORY_OWNERS),
  sourceRootFiles: Object.keys(SOURCE_ROOT_FILE_OWNERS),
  componentDirectories: Object.keys(COMPONENT_DIRECTORY_OWNERS),
  componentRootFiles: [
    ...Object.keys(COMPONENT_ROOT_FILE_OWNERS),
    "notesSurface.tsx",
    "renameDialog.tsx",
    "glyphs.test.tsx",
  ],
  serviceFiles: Object.keys(SERVICE_FILE_OWNERS),
});

describe("source ownership registry", () => {
  test("accepts declared capability roots, presentation clusters, and entry points", () => {
    expect(sourceOwnershipViolations(completeSnapshot())).toEqual([]);
  });

  test("rejects unowned roots and feature helpers scattered into components", () => {
    const snapshot = completeSnapshot();
    snapshot.sourceDirectories.push("misc");
    snapshot.sourceRootFiles.push("helper.ts");
    snapshot.componentDirectories.push("bits");
    snapshot.componentRootFiles.push("accountPicker.tsx");
    snapshot.serviceFiles.push("misc.ts");

    expect(sourceOwnershipViolations(snapshot)).toEqual(
      expect.arrayContaining([
        "src/misc: top-level source directory has no declared owner",
        "src/helper.ts: root source file has no declared owner; place it in a capability directory",
        "src/components/bits: presentation feature directory has no declared owner",
        "src/components/accountPicker.tsx: feature-specific presentation belongs in a declared components/<feature>/ directory",
        "src/services/misc.ts: application service has no declared capability owner",
      ]),
    );
  });

  test("rejects stale ownership entries and orphaned root tests", () => {
    const snapshot = completeSnapshot();
    snapshot.sourceDirectories = snapshot.sourceDirectories.filter((directory) => directory !== "voice");
    snapshot.componentRootFiles = snapshot.componentRootFiles
      .filter((file) => file !== "glyphs.tsx")
      .concat("orphan.test.ts");
    snapshot.serviceFiles = snapshot.serviceFiles.filter((file) => file !== "notes.ts");

    expect(sourceOwnershipViolations(snapshot)).toEqual(
      expect.arrayContaining([
        "src/voice: declared source owner is stale; directory is missing",
        "src/components/glyphs.tsx: declared root-component owner is stale; file is missing",
        "src/components/orphan.test.ts: root test has no colocated production companion orphan.ts(x)",
        "src/services/notes.ts: declared service owner is stale; file is missing",
      ]),
    );
  });
});
