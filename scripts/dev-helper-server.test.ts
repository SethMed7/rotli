// The pure parts of scripts/dev-helper-server.ts (the Vite dev-only plugin
// vite.config.ts mounts for the web platform).
import { describe, expect, test } from "bun:test";

import { localAssetName, localBinaryCandidates, localizedInstaller } from "./dev-helper-server";

describe("dev helper server", () => {
  test("names the asset the release workflow would publish for this machine", () => {
    expect(localAssetName("darwin", "arm64")).toBe("rotli-helper-macos-arm64");
    expect(localAssetName("linux", "x64")).toBe("rotli-helper-linux-x64");
    expect(localAssetName("win32", "x64")).toBe("rotli-helper-windows-x64.exe");
    expect(localAssetName("freebsd", "x64")).toBeNull();
  });

  test("looks for a built helper in the repo, the cargo target dir, then the installed copy", () => {
    const paths = localBinaryCandidates("/repo", { CARGO_TARGET_DIR: "/cache" }, "/home/me");
    expect(paths).toEqual([
      "/repo/src-tauri/target/release/rotli-helper",
      "/cache/release/rotli-helper",
      "/home/me/.rotli/bin/rotli-helper",
    ]);
    expect(localBinaryCandidates("/repo", {}, "/home/me")).toHaveLength(2);
  });

  test("the served installer downloads from this origin instead of the releases repository", () => {
    const script =
      'RELEASES="${ROTLI_HELPER_RELEASES:-https://github.com/SethMed7/rotli-releases/releases/download}"';
    expect(localizedInstaller(script, "http://localhost:1437")).toBe(
      'RELEASES="${ROTLI_HELPER_RELEASES:-http://localhost:1437/helper/releases}"',
    );
  });
});
