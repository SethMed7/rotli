// The file surface — renders a surfaced binary (kind "file") IN-APP, in a pane,
// instead of shelling it to the OS. Covers audio/video (a real player), images,
// pdf, spreadsheets (xlsx/csv → a table, read-only), and text; ANY other type
// falls back to an asset <iframe> (WKWebView previews most), then an "Open
// externally" escape hatch. Read-only — the file stays the source of truth.

import { useEffect, useState } from "react";
import { corpusFileBytes, corpusFileText, corpusOpenFile, fileAssetUrl } from "../lib/tauri";
import { IMAGE_EXTS, extOf, fileName } from "../lib/fileKind";
import { type SheetTable, parseWorkbook } from "../lib/sheets";

type FileKind = "audio" | "video" | "image" | "pdf" | "sheet" | "text" | "other";

const AUDIO = new Set(["mp3", "m4a", "wav", "aac", "flac", "ogg", "oga", "opus"]);
const VIDEO = new Set(["mp4", "mov", "webm", "m4v", "ogv"]);
// the viewer can <img> svg/ico too, so it broadens the shared raster set.
const IMAGE = new Set([...IMAGE_EXTS, "svg", "ico"]);
const SHEET_TEXT = new Set(["csv", "tsv"]);
const SHEET_BIN = new Set(["xlsx", "xls", "xlsm", "ods"]);
const TEXT = new Set(["txt", "text", "log", "json", "md", "markdown", "yaml", "yml", "xml", "vtt", "srt", "html", "rtf"]);

function kindOf(name: string): FileKind {
  const ext = extOf(name);
  if (AUDIO.has(ext)) return "audio";
  if (VIDEO.has(ext)) return "video";
  if (IMAGE.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (SHEET_TEXT.has(ext) || SHEET_BIN.has(ext)) return "sheet";
  if (TEXT.has(ext) || name.toLowerCase().endsWith(".audio.txt")) return "text";
  return "other";
}

export function FileSurface({ fileId }: { paneId: string; fileId: string }) {
  const name = fileName(fileId);
  const kind = kindOf(name);
  const [url, setUrl] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [tables, setTables] = useState<SheetTable[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl("");
    setText(null);
    setTables(null);
    setActiveSheet(0);
    setErr(null);
    const fail = (e: unknown) => !cancelled && setErr((e as Error)?.message ?? "couldn't load the file");

    if (kind === "text") {
      corpusFileText(fileId).then((t) => !cancelled && setText(t)).catch(fail);
    } else if (kind === "sheet") {
      const ext = extOf(name);
      const load = SHEET_BIN.has(ext)
        ? corpusFileBytes(fileId).then((b64) => parseWorkbook({ base64: b64 }))
        : corpusFileText(fileId).then((csv) => parseWorkbook({ csv }));
      load.then((t) => !cancelled && setTables(t)).catch(fail);
    } else {
      // audio / video / image / pdf / other → an asset:// URL for the tag
      fileAssetUrl(fileId)
        .then((u) => !cancelled && (u ? setUrl(u) : setErr("couldn't resolve the file")))
        .catch(fail);
    }
    return () => {
      cancelled = true;
    };
  }, [fileId, kind, name]);

  const loadingMedia = (kind === "audio" || kind === "video" || kind === "image" || kind === "pdf" || kind === "other") && !url && !err;
  const loadingText = kind === "text" && text === null && !err;
  const loadingSheet = kind === "sheet" && tables === null && !err;
  const sheet = tables?.[activeSheet];

  return (
    <div className="file-surface">
      <header className="file-head">
        <span className="file-name" title={name}>
          {name}
        </span>
        <button
          type="button"
          className="file-open-ext"
          title="Open in the default app / reveal in Finder"
          onClick={() => void corpusOpenFile(fileId)}
        >
          Open externally
        </button>
      </header>

      <div className={kind === "sheet" ? "file-body file-body-sheet" : "file-body"}>
        {err && <p className="file-err">⚠ {err}</p>}
        {(loadingMedia || loadingText || loadingSheet) && <p className="file-loading">Loading…</p>}

        {!err && kind === "audio" && url && (
          <div className="file-audio-wrap">
            <audio className="file-audio" controls preload="metadata" src={url} />
          </div>
        )}
        {!err && kind === "video" && url && (
          <video className="file-video" controls preload="metadata" src={url} />
        )}
        {!err && kind === "image" && url && <img className="file-image" src={url} alt={name} />}
        {!err && kind === "pdf" && url && <iframe className="file-pdf" title={name} src={url} />}
        {!err && kind === "text" && text !== null && (
          <pre className="file-text">{text || "(empty file)"}</pre>
        )}

        {!err && kind === "sheet" && tables && (
          <div className="file-sheet">
            {tables.length > 1 && (
              <div className="file-sheet-tabs">
                {tables.map((t, i) => (
                  <button
                    key={t.name}
                    type="button"
                    className={i === activeSheet ? "fsh-tab on" : "fsh-tab"}
                    onClick={() => setActiveSheet(i)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            <div className="file-sheet-scroll">
              {sheet && sheet.rows.length > 0 ? (
                <table className="file-table">
                  <tbody>
                    {sheet.rows.map((row, ri) => (
                      <tr key={ri}>
                        <td className="fsh-rownum">{ri + 1}</td>
                        {row.map((cell, ci) =>
                          ri === 0 ? <th key={ci}>{cell}</th> : <td key={ci}>{cell}</td>,
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="file-loading">(empty sheet)</p>
              )}
            </div>
          </div>
        )}

        {/* universal fallback: let WKWebView preview anything else in an iframe */}
        {!err && kind === "other" && url && <iframe className="file-frame" title={name} src={url} />}
      </div>
    </div>
  );
}
