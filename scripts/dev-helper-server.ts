// Rotli Web dev server: serve the Rotli Helper installers and a local
// "release" of the helper, so the one-line install the dialog shows works
// against http://localhost:<port> exactly as it will against rotli.co.
//
// In production the site serves site/public/helper/*.sh|.ps1 as-is and they
// download from the releases repository. Here the same scripts are served
// with their download base rewritten to this server, which answers with the
// helper binary already built on this machine (or installed in ~/.rotli/bin)
// plus a checksum file computed from it. Dev only: `apply: "serve"`.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Plugin } from "vite";

const RELEASES_DEFAULT = "https://github.com/SethMed7/rotli-releases/releases/download";

function crateVersion(root: string): string {
  const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  return cargo.match(/^version = "([^"]+)"/m)?.[1] ?? "0.0.0";
}

/** The asset name this machine's build would be published under. */
export function localAssetName(platform = process.platform, arch = process.arch): string | null {
  const os =
    platform === "darwin"
      ? "macos"
      : platform === "linux"
        ? "linux"
        : platform === "win32"
          ? "windows"
          : null;
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
  if (!os || !cpu) return null;
  return `rotli-helper-${os}-${cpu}${os === "windows" ? ".exe" : ""}`;
}

/** Where a built helper may sit on this machine, first hit wins. */
export function localBinaryCandidates(root: string, env = process.env, home = homedir()): string[] {
  const exe = process.platform === "win32" ? "rotli-helper.exe" : "rotli-helper";
  return [
    join(root, "src-tauri/target/release", exe),
    ...(env.CARGO_TARGET_DIR ? [join(env.CARGO_TARGET_DIR, "release", exe)] : []),
    join(home, ".rotli/bin", exe),
  ];
}

/** The installer text for this origin: same script, local download base. */
export function localizedInstaller(script: string, origin: string): string {
  return script.replaceAll(RELEASES_DEFAULT, `${origin}/helper/releases`);
}

export function devHelperServer(root: string): Plugin {
  return {
    name: "rotli-dev-helper-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/helper/")) return next();
        const origin = `http://${req.headers.host ?? "localhost"}`;
        const version = crateVersion(root);
        const send = (status: number, body: string | Buffer, type: string) => {
          res.statusCode = status;
          res.setHeader("content-type", type);
          res.setHeader("cache-control", "no-store");
          res.end(body);
        };
        if (url === "/helper/install.sh" || url === "/helper/install.ps1") {
          const script = readFileSync(join(root, "site/public/helper", url.slice("/helper/".length)), "utf8");
          return send(200, localizedInstaller(script, origin), "text/plain; charset=utf-8");
        }
        const release = url.match(/^\/helper\/releases\/helper-v([^/]+)\/([^/?]+)$/);
        if (!release) return send(404, "not found\n", "text/plain; charset=utf-8");
        if (release[1] !== version)
          return send(404, `this dev server serves helper-v${version}\n`, "text/plain; charset=utf-8");
        const asset = localAssetName();
        const binary = localBinaryCandidates(root).find((p) => existsSync(p));
        if (!asset || !binary) {
          return send(
            404,
            "no helper binary on this machine yet — build it: cargo build --release --bin rotli-helper (in the Rotli repo)\n",
            "text/plain; charset=utf-8",
          );
        }
        const bytes = readFileSync(binary);
        if (release[2] === "SHA256SUMS") {
          const sum = createHash("sha256").update(bytes).digest("hex");
          return send(200, `${sum} ${asset}\n`, "text/plain; charset=utf-8");
        }
        if (release[2] === asset) return send(200, bytes, "application/octet-stream");
        return send(404, `only ${asset} is built on this machine\n`, "text/plain; charset=utf-8");
      });
    },
  };
}
