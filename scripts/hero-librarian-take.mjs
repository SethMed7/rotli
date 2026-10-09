// The hero film's Mac take (capture-hero.mjs, site/README.md "Films"): the Librarian filing the
// note written on camera, shot in a debug build of the app that cannot reach the owner's Rotli.
//
//   ROTLI_BUILD_CHANNEL=stable bun run tauri build --debug --no-bundle \
//     --config src-tauri/tauri.dev.conf.json --config '{"identifier":"com.rotli.dev"}'
//   bun scripts/hero-librarian-take.mjs        # → _review/hero-video/librarian-clip.mp4
//   bun scripts/hero-librarian-take.mjs --cut  # re-cut the last take (/tmp/rotli-hero/take.json)
//
// Why it is safe (2026-10-09: an edited corpus.json in the installed app reverted to the real
// vault between launches, and a write landed there):
//   - the build has its own identifier (com.rotli.dev) and runs with a sandbox HOME, so its
//     settings, viewstate, model list, and helper token all live under /tmp/rotli-hero/home;
//   - it is started as a bare binary (never `open`, never the rotli CLI or a rotli:// link,
//     which reach the installed app), and its vault is a fresh demo vault in /tmp/rotli-hero;
//   - the vault path is re-read from the sandbox config right before launch, and the owner's
//     config folder and ~/memex-vault/.rotli are stat-compared before and after.
// The window is recorded alone (ScreenCaptureKit), so nothing else on the desk is in the shot;
// focus goes back to the app that had it, which also lets the Librarian run (it waits while
// Rotli is focused and the person is active). Needs the on-device model at localhost:11435.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const ROOT = "/tmp/rotli-hero";
const SBX = join(ROOT, "home");
const VAULT = join(ROOT, "Rotli Hero Demo");
const CFG = join(SBX, "Library/Application Support/com.rotli.dev");
const BIN = join(repo, "src-tauri/target/debug/rotli");
const RECORDER = join(ROOT, "tools/record");
const OUT = join(repo, "_review/hero-video/librarian-clip.mp4");
const REAL = [
  join(homedir(), "Library/Application Support/com.rotli.app"),
  join(homedir(), "memex-vault/.rotli"),
];
const BEFORE_S = 4; // seconds of the note waiting in _inbox before the move
const AFTER_S = 5; // and of the fields settling after it
const TIMEOUT_S = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr || r.stdout}`);
  return typeof r.stdout === "string" ? r.stdout.trim() : r.stdout;
};

const TAKE = join(ROOT, "take.json");
if (!process.argv.includes("--cut")) await shoot();
const { movedOffset } = JSON.parse(await readFile(TAKE, "utf8"));

// The cut: the note waiting, the move, the fields settling, cropped from the top to the film's
// own picture shape (1920 × 918, so it fills the frame like the web takes, the empty foot of the
// window off), with macOS's purple "being recorded" badge (where the traffic lights sit) filled in
// from the titlebar around it, and the window's black top corners painted the titlebar's colour.
const t0 = Math.max(0, movedOffset - BEFORE_S);
const bar = run(
  "ffmpeg",
  [
    "-v",
    "error",
    "-ss",
    String(t0),
    "-i",
    join(ROOT, "take.mov"),
    "-frames:v",
    "1",
    "-vf",
    "crop=1:1:190:36,format=rgb24",
    "-f",
    "rawvideo",
    "-",
  ],
  { encoding: "buffer" },
);
const hex = [...bar.subarray(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join("");
await mkdir(join(repo, "_review/hero-video"), { recursive: true });
run("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-ss",
  String(t0),
  "-t",
  String(BEFORE_S + AFTER_S),
  "-i",
  join(ROOT, "take.mov"),
  "-vf",
  [
    "crop=iw:trunc(iw*918/1920/2)*2:0:0",
    `drawbox=x=0:y=0:w=48:h=30:color=0x${hex}:t=fill`,
    `drawbox=x=0:y=0:w=10:h=78:color=0x${hex}:t=fill`,
    "delogo=x=1:y=1:w=190:h=74",
    `drawbox=x=iw-48:y=0:w=48:h=30:color=0x${hex}:t=fill`,
    "fps=30,format=yuv420p",
  ].join(","),
  "-c:v",
  "libx264",
  "-crf",
  "16",
  "-preset",
  "slow",
  "-an",
  OUT,
]);
console.log(`Mac clip: ${OUT} (${BEFORE_S + AFTER_S}s, from ${t0.toFixed(1)}s of the take)`);

async function shoot() {
  if (!existsSync(BIN)) throw new Error(`No debug build at ${BIN}; build it first (see the header)`);
  if (VAULT.startsWith(homedir())) throw new Error("The demo vault must live outside the real home");
  const probe = await fetch("http://localhost:11435/api/generate", {
    method: "POST",
    body: JSON.stringify({ model: "gemma-3-12b-it-qat-4bit", prompt: "Say ok.", stream: false }),
  }).catch(() => null);
  if (!probe?.ok) throw new Error("The on-device model at localhost:11435 is not answering");

  /** mtime of every file directly in the owner's Rotli folders; compared after the take. */
  async function snapshot() {
    const seen = {};
    for (const dir of REAL)
      for (const name of await readdir(dir).catch(() => []))
        seen[join(dir, name)] = (await stat(join(dir, name)).catch(() => null))?.mtimeMs ?? null;
    return seen;
  }

  // The recorder: one window by its owner's pid, until SIGINT.
  if (!existsSync(RECORDER)) {
    await mkdir(join(ROOT, "tools"), { recursive: true });
    await writeFile(`${RECORDER}.swift`, RECORDER_SWIFT());
    run("swiftc", ["-O", `${RECORDER}.swift`, "-o", RECORDER]);
  }

  // A fresh demo vault every take: the Librarian files the note once, so a second take needs a new one.
  if (existsSync(VAULT)) {
    if (!existsSync(join(VAULT, "README-DEMO.txt"))) throw new Error(`${VAULT} is not the demo vault`);
    await rm(VAULT, { recursive: true });
  }
  run("bun", [join(repo, "scripts/hero-librarian-vault.mjs"), VAULT]);
  const main = JSON.parse(await readFile(join(VAULT, ".rotli/main.json"), "utf8"));
  const noteId = main.tree[0].note;
  await writeFile(join(VAULT, ".rotli/workspace-open.json"), JSON.stringify({ id: noteId, kind: "note" }));

  // The sandbox: its own home, settings that skip onboarding and keep the window up when it loses
  // focus, the Vault view, and the same quiet chrome as the web take.
  await rm(SBX, { recursive: true, force: true });
  await mkdir(CFG, { recursive: true });
  await mkdir(join(SBX, ".memex/ai"), { recursive: true });
  // a copy, never a link: the app's model installer may write it
  await cp(join(homedir(), ".memex/ai/registry.json"), join(SBX, ".memex/ai/registry.json")).catch(() => {});
  await writeFile(
    join(CFG, "corpus.dev.json"),
    JSON.stringify({
      version: 1,
      corpus: { absPath: VAULT, adopted: false },
      brains: [],
      folders: [],
      activeBrainId: null,
    }),
  );
  await writeFile(
    join(CFG, "app-settings.dev.json"),
    JSON.stringify({
      onboarded: true,
      onboardingVersion: "1.7.1",
      lastSeenVersion: "1.7.1",
      onboardingPhase: "shortcuts",
      stayOpen: true,
      showInDock: false,
      vaultView: true,
      ambient: { enabled: false, playing: false },
      hidden: { overview: true, allNotes: true, captures: true, tasks: true },
    }),
  );

  const real = await snapshot();
  const pointed = JSON.parse(await readFile(join(CFG, "corpus.dev.json"), "utf8")).corpus.absPath;
  if (pointed !== VAULT) throw new Error(`The sandbox points at ${pointed}, not the demo vault; stopping`);

  const front = run("lsappinfo", ["info", "-only", "bundleid", run("lsappinfo", ["front"])]).match(
    /"([^"]+)"$/,
  )?.[1];
  const app = spawn(BIN, [], {
    env: { ...process.env, HOME: SBX, ROTLI_BUILD_CHANNEL: "stable" },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const launchedAt = Date.now();
  console.log(`Test app pid ${app.pid}, vault ${VAULT}, note ${noteId}`);

  let rec;
  let recStart = 0;
  let movedAt = 0;
  try {
    await sleep(8000);
    rec = spawn(RECORDER, [String(app.pid), join(ROOT, "take.mov")], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    rec.stdout.on("data", (b) => {
      const text = String(b);
      if (!recStart && text.includes("recording")) recStart = Date.now();
      process.stdout.write(`recorder: ${text}`);
    });
    await sleep(1500);
    if (front && front !== "null")
      spawnSync("osascript", ["-e", `tell application id "${front}" to activate`], { stdio: "ignore" });

    const clients = join(VAULT, "wiki/Clients");
    const filed = (names) => names.find((n) => !n.startsWith("_") && !n.startsWith("Discount policy"));
    while (Date.now() - launchedAt < TIMEOUT_S * 1000) {
      if (filed(await readdir(clients))) {
        movedAt = Date.now();
        break;
      }
      await sleep(250);
    }
    if (!movedAt) throw new Error(`The Librarian did not file the note within ${TIMEOUT_S}s`);
    console.log(`Filed ${Math.round((movedAt - launchedAt) / 1000)}s after launch`);
    await writeFile(TAKE, JSON.stringify({ movedOffset: (movedAt - recStart) / 1000, noteId }));
    await sleep(AFTER_S * 1000 + 1000);
  } finally {
    rec?.kill("SIGINT");
    await sleep(4000);
    app.kill("SIGTERM");
    await sleep(1500);
    if (app.exitCode === null) app.kill("SIGKILL");
  }

  const after = await snapshot();
  const changed = [...new Set([...Object.keys(real), ...Object.keys(after)])].filter(
    (p) => real[p] !== after[p],
  );
  if (changed.length) {
    console.error("The owner's Rotli files changed during the take (another Rotli running?):");
    for (const p of changed) console.error(`  ${p}`);
    process.exitCode = 1;
  } else console.log("Owner's Rotli settings and ~/memex-vault/.rotli: untouched");
}

function RECORDER_SWIFT() {
  return String.raw`import AVFoundation
import AppKit
import Foundation
import ScreenCaptureKit

let args = CommandLine.arguments
guard args.count == 3, let pid = Int32(args[1]) else { print("usage: record <pid> <out.mov>"); exit(2) }
let out = URL(fileURLWithPath: args[2])
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

final class Delegate: NSObject, SCRecordingOutputDelegate, SCStreamDelegate {
  func recordingOutputDidStartRecording(_ r: SCRecordingOutput) { print("recording"); fflush(stdout) }
  func recordingOutputDidFinishRecording(_ r: SCRecordingOutput) { print("finished"); fflush(stdout); exit(0) }
  func recordingOutput(_ r: SCRecordingOutput, didFailWithError e: Error) { print("failed \(e)"); exit(1) }
  func stream(_ s: SCStream, didStopWithError e: Error) { print("stream stopped \(e)"); exit(1) }
}
let delegate = Delegate()
var stream: SCStream?

Task { @MainActor in
  do {
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
    guard let window = content.windows
      .filter({ $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width > 300 })
      .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
    else { print("no window for pid \(pid)"); exit(1) }
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let config = SCStreamConfiguration()
    let scale = CGFloat(filter.pointPixelScale)
    config.width = Int(window.frame.width * scale)
    config.height = Int(window.frame.height * scale)
    config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
    config.showsCursor = false
    let s = SCStream(filter: filter, configuration: config, delegate: delegate)
    let rc = SCRecordingOutputConfiguration()
    rc.outputURL = out
    rc.outputFileType = .mov
    try s.addRecordingOutput(SCRecordingOutput(configuration: rc, delegate: delegate))
    try await s.startCapture()
    stream = s
    print("window \(window.windowID) \(Int(window.frame.width))x\(Int(window.frame.height))"); fflush(stdout)
  } catch { print("error \(error)"); exit(1) }
}

signal(SIGINT, SIG_IGN)
let stop = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
stop.setEventHandler {
  Task { try? await stream?.stopCapture(); DispatchQueue.main.asyncAfter(deadline: .now() + 3) { exit(0) } }
}
stop.resume()
app.run()
`;
}
