// The file surface — renders a surfaced binary (kind "file") IN-APP, in a pane,
// instead of shelling it to the OS. Covers audio/video (a real player), images,
// pdf, spreadsheets (xlsx/csv → EDITABLE grid when the root is writable, a
// read-only table otherwise), and text; ANY other type falls back to an asset
// <iframe> (WKWebView previews most), then the "Open externally" escape hatch —
// now a dropdown (default app / Reveal in Finder / installed "Open with" apps)
// on the shared context-menu host. The file stays the source of truth.

import { type MouseEvent as ReactMouseEvent, Suspense, lazy, useEffect, useState } from "react";
import {
  type FileStat,
  corpusFileBytes,
  corpusFileStat,
  corpusFileText,
  corpusOpenFile,
  corpusOpenFileWith,
  corpusOpenWithApps,
  corpusRevealFile,
  fileAssetUrl,
} from "../lib/tauri";
import { IMAGE_EXTS, extOf, fileName } from "../lib/fileKind";
import { SHEET_EDIT_MAX_BYTES } from "../lib/sheetEdit";
import { type SheetTable, parseWorkbook } from "../lib/sheets";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";

// exceljs is heavy (~250KB gz) and most sessions never edit a spreadsheet —
// code-split the editor so it loads only when an editable sheet mounts
// (same reasoning as the CanvasSurface split).
const SheetEditor = lazy(() => import("./SheetEditor"));

type FileKind = "audio" | "video" | "image" | "pdf" | "sheet" | "text" | "other";

const AUDIO = new Set(["mp3", "m4a", "wav", "aac", "flac", "ogg", "oga", "opus"]);
const VIDEO = new Set(["mp4", "mov", "webm", "m4v", "ogv"]);
// the viewer can <img> svg/ico too, so it broadens the shared raster set.
const IMAGE = new Set([...IMAGE_EXTS, "svg", "ico"]);
const SHEET_TEXT = new Set(["csv", "tsv"]);
const SHEET_BIN = new Set(["xlsx", "xls", "xlsm", "ods"]);
const TEXT = new Set(["txt", "text", "log", "json", "md", "markdown", "yaml", "yml", "xml", "vtt", "srt", "html", "rtf"]);

// exceljs only round-trips real .xlsx; csv is the values-only text path. The
// rest of the sheet family (xls/xlsm/ods/tsv) stays the read-only viewer.
// SHEET_EDIT_MAX_BYTES (sheetEdit.ts) gates edit mode: a capped (truncated)
// read must never be edited and written back, so bigger files stay read-only.
const SHEET_EDITABLE = new Set(["xlsx", "csv"]);

// which installed "Open with …" apps make sense per kind (Rust reports what exists)
const OPEN_WITH_BY_KIND: Record<FileKind, string[]> = {
  sheet: ["Numbers", "Microsoft Excel"],
  text: ["TextEdit"],
  image: ["Preview"],
  pdf: ["Preview"],
  audio: [],
  video: [],
  other: [],
};

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
  const ext = extOf(name);
  const [url, setUrl] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [tables, setTables] = useState<SheetTable[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  // null = probing; the probe decides editable vs read-only viewer for sheets
  const [stat, setStat] = useState<FileStat | null>(null);
  const [probed, setProbed] = useState(false);
  const [apps, setApps] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const openMenu = useContextMenu((s) => s.open);

  const sheetEditable =
    kind === "sheet" &&
    SHEET_EDITABLE.has(ext) &&
    !!stat?.writable &&
    stat.len <= SHEET_EDIT_MAX_BYTES;

  useEffect(() => {
    let cancelled = false;
    setUrl("");
    setText(null);
    setTables(null);
    setActiveSheet(0);
    setStat(null);
    setProbed(false);
    setErr(null);
    const fail = (e: unknown) => !cancelled && setErr((e as Error)?.message ?? "couldn't load the file");

    // the dropdown's "Open with …" entries — only what's actually installed
    corpusOpenWithApps()
      .then((a) => !cancelled && setApps(a))
      .catch(() => {});

    if (kind === "text") {
      corpusFileText(fileId).then((t) => !cancelled && setText(t)).catch(fail);
    } else if (kind === "sheet") {
      // probe first: an editable sheet mounts the editor (which loads its own
      // data); everything else falls back to the read-only table
      corpusFileStat(fileId)
        .catch(() => null)
        .then((s) => {
          if (cancelled) return;
          setStat(s);
          setProbed(true);
          const editable =
            SHEET_EDITABLE.has(ext) && !!s?.writable && s.len <= SHEET_EDIT_MAX_BYTES;
          if (editable) return;
          const load = SHEET_BIN.has(ext)
            ? corpusFileBytes(fileId).then((b64) => parseWorkbook({ base64: b64 }))
            : corpusFileText(fileId).then((csv) => parseWorkbook({ csv }));
          load.then((t) => !cancelled && setTables(t)).catch(fail);
        });
    } else {
      // audio / video / image / pdf / other → an asset:// URL for the tag
      fileAssetUrl(fileId)
        .then((u) => !cancelled && (u ? setUrl(u) : setErr("couldn't resolve the file")))
        .catch(fail);
    }
    return () => {
      cancelled = true;
    };
  }, [fileId, kind, ext]);

  const openExternally = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const items: MenuSpec[] = [
      { kind: "action", label: "Open with default app", onClick: () => void corpusOpenFile(fileId) },
      { kind: "action", label: "Reveal in Finder", onClick: () => void corpusRevealFile(fileId) },
    ];
    const withApps = OPEN_WITH_BY_KIND[kind].filter((a) => apps.includes(a));
    if (withApps.length > 0) items.push({ kind: "sep" });
    for (const app of withApps) {
      items.push({
        kind: "action",
        label: `Open with ${app}`,
        onClick: () => void corpusOpenFileWith(fileId, app),
      });
    }
    const r = event.currentTarget.getBoundingClientRect();
    openMenu(r.left, r.bottom + 4, items);
  };

  const loadingMedia = (kind === "audio" || kind === "video" || kind === "image" || kind === "pdf" || kind === "other") && !url && !err;
  const loadingText = kind === "text" && text === null && !err;
  const loadingSheet = kind === "sheet" && !err && (!probed || (!sheetEditable && tables === null));
  const sheet = tables?.[activeSheet];

  return (
    <div className="file-surface">
      <header className="file-head">
        <span className="file-name" title={name}>
          {name}
        </span>
        {kind === "sheet" && probed && !sheetEditable && stat !== null && !stat.writable && (
          <span className="file-readonly" title="This root is read-only — rotli never writes it">
            read-only
          </span>
        )}
        <button
          type="button"
          className="file-open-ext"
          title="Open in the default app / reveal in Finder / open with…"
          onClick={openExternally}
        >
          Open externally <span aria-hidden="true">▾</span>
        </button>
      </header>

      <div
        className={
          kind === "sheet"
            ? "file-body file-body-sheet"
            : kind === "image" || kind === "pdf" || kind === "other"
              ? "file-body file-body-fill"
              : "file-body"
        }
      >
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

        {!err && kind === "sheet" && probed && sheetEditable && (
          <Suspense fallback={<p className="file-loading">Loading…</p>}>
            <SheetEditor key={fileId} fileId={fileId} mode={ext === "csv" ? "csv" : "xlsx"} />
          </Suspense>
        )}

        {!err && kind === "sheet" && !sheetEditable && tables && (
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
