/**
 * One place that knows how Breve turns an HTML file into a PDF.
 *
 * The path used to be hardcoded in both render-brief.ts and email-topic.ts.
 * That cost more than the duplication: email-topic.ts spelled it inside Bun's
 * `$` template shell, so knip parsed it as a binary and tried to resolve it —
 * green on a developer Mac where the path exists, red on Linux CI where it
 * does not. The suppression that hid this was deleted in #118 and restored in
 * #120; resolving the binary through a variable removes the need for it.
 *
 * The two call sites had also drifted: render-brief passed --no-sandbox and
 * checked that a PDF actually appeared, while email-topic did neither and read
 * a file that might never have been written. One renderer, one behavior.
 */
import { existsSync } from "node:fs";

/** Checked in order. Chrome first — it is what Breve has always rendered with. */
export const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/**
 * Pure resolution policy: an explicit override always wins, otherwise the
 * first candidate that exists. Returns null when nothing is installed so the
 * caller can report a real reason instead of failing on a missing file later.
 */
export function pickChrome(
  candidates: readonly string[],
  exists: (path: string) => boolean,
  override?: string,
): string | null {
  if (override) return override;
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

export function chromeBinary(): string | null {
  return pickChrome(CHROME_CANDIDATES, existsSync, process.env.ROTLI_CHROME_BIN);
}

/**
 * Render `htmlPath` to `pdfPath`. Throws with a reportable reason rather than
 * leaving a caller to read a PDF that was never written.
 */
export async function renderPdf(htmlPath: string, pdfPath: string): Promise<void> {
  const chrome = chromeBinary();
  if (!chrome) {
    throw new Error(
      "no headless Chrome found — install Google Chrome or set ROTLI_CHROME_BIN to a Chromium-family binary",
    );
  }
  const proc = Bun.spawn(
    [
      chrome,
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0 || !(await Bun.file(pdfPath).exists())) {
    throw new Error(`Chrome PDF render failed (exit ${code}): ${stderr.slice(0, 300)}`);
  }
}
