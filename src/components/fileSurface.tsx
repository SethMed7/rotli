// The file surface — renders a surfaced binary (kind "file") IN-APP, in a pane,
// instead of shelling it to the OS. Covers audio/video (a real player), images
// (fit / 100% / ⌘±-and-pinch zoom with scroll-pan), pdf, Word documents (local
// DOCX editing with package-preserving saves), spreadsheets (xlsx/csv → EDITABLE grid
// when the root is writable, a read-only table otherwise),
// html (Preview in a sandboxed srcdoc iframe — scripts AND network egress
// blocked ⇄ Code, the raw source), and text; ANY other type falls back to an
// asset <iframe> (WKWebView previews most), then the "Open externally" escape
// hatch — now a dropdown (default app / Reveal in Finder / installed "Open
// with" apps) on the shared context-menu host. The file is the source of truth.

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  DOCX_EDITABLE,
  DOCUMENT_CONVERTIBLE,
  DOCUMENT_EDIT_MAX_BYTES,
  DOCUMENT_EXTS,
  DOCUMENT_OPEN_WITH_APPS,
} from "../documents/kinds";
import { clamp } from "../lib/clamp";
import { IMAGE_EXTS, VIDEO_EXTS, extOf, fileName } from "../lib/fileKind";
import {
  type FileStat,
  corpusFileBytes,
  corpusFileStat,
  corpusFileText,
  corpusNoteAbsolutePath,
  corpusOpenFile,
  corpusOpenFileWith,
  corpusOpenWithApps,
  corpusRevealFile,
  fileAssetUrl,
  isTauri,
} from "../lib/tauri";
import { deriveSheetFacts, describeShape, formatStamp, sizeLine } from "../sheets/facts";
import * as sheetKinds from "../sheets/kinds";
import { type SheetTable, parseWorkbook } from "../sheets/view";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";

// Univer + exceljs are heavy — code-split so they load only when an editable
// sheet mounts (same reasoning as the CanvasSurface split).
const SheetEditor = lazy(() => import("../sheets/sheetEditor"));
const DocumentEditor = lazy(() => import("./documentEditor"));

export type FileKind = "audio" | "video" | "image" | "pdf" | "sheet" | "document" | "text" | "html" | "other";

/** Slot in the file header for sheet chrome (Raw / Save) next to Open externally. */

const AUDIO = new Set(["mp3", "m4a", "wav", "aac", "flac", "ogg", "oga", "opus"]);
const VIDEO = VIDEO_EXTS;
// the image viewer handles svg/ico too, so it broadens the shared raster set.
const IMAGE = new Set([...IMAGE_EXTS, "svg", "ico"]);
// html gets its own two-mode kind (Preview ⇄ Code) — it used to sit in TEXT.
const HTML = new Set(["html", "htm", "xhtml"]);
const TEXT = new Set(["txt", "text", "log", "json", "md", "markdown", "yaml", "yml", "xml", "vtt", "srt"]);

// exceljs only round-trips real .xlsx; csv is the values-only text path. The
// rest of the sheet family (xls/xlsm/ods/tsv) stays the read-only viewer.

// which installed "Open with …" apps make sense per kind (Rust reports what exists)
const OPEN_WITH_BY_KIND: Record<FileKind, string[]> = {
  sheet: ["Numbers", "Microsoft Excel"],
  document: [...DOCUMENT_OPEN_WITH_APPS],
  text: ["TextEdit"],
  html: ["Safari", "TextEdit"],
  image: ["Preview"],
  pdf: ["Preview"],
  audio: [],
  video: [],
  other: [],
};

/** Exported for tests — the pure ext → viewer-kind decision. */
export function kindOf(name: string): FileKind {
  const ext = extOf(name);
  if (AUDIO.has(ext)) return "audio";
  if (VIDEO.has(ext)) return "video";
  if (IMAGE.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (sheetKinds.SHEET_TEXT.has(ext) || sheetKinds.SHEET_BIN.has(ext)) return "sheet";
  if (DOCUMENT_EXTS.has(ext)) return "document";
  if (HTML.has(ext)) return "html";
  if (TEXT.has(ext) || name.toLowerCase().endsWith(".audio.txt")) return "text";
  return "other";
}

// ── image zoom (fit / 100% / steps) — pure math, exported for tests ──────────
// Scale 1 = "actual size" in POINTS (natural px ÷ devicePixelRatio), matching
// Preview — a retina screenshot at 100% shows at its on-screen point size.

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;

/** Clamp a zoom scale into the sane band (garbage in → 1). */
export function clampZoom(s: number): number {
  if (!Number.isFinite(s) || s <= 0) return 1;
  return clamp(s, ZOOM_MIN, ZOOM_MAX);
}

/** The "fit" scale: contain the image in the body, but NEVER upscale past
 * actual size — a 32px icon stays 32px crisp instead of blurring to the pane. */
export function fitScale(natW: number, natH: number, bodyW: number, bodyH: number, dpr: number): number {
  const pw = natW / (dpr || 1);
  const ph = natH / (dpr || 1);
  if (pw <= 0 || ph <= 0 || bodyW <= 0 || bodyH <= 0) return 1;
  return Math.min(1, bodyW / pw, bodyH / ph);
}

/** One ⌘± / pinch zoom step — multiplicative, clamped. */
export function zoomStep(scale: number, dir: 1 | -1): number {
  return clampZoom(dir > 0 ? scale * 1.25 : scale / 1.25);
}

// the read-only sheet AND html paths read through corpus_file_bytes/_text —
// this mirrors the Rust-side cap so we can refuse HONESTLY instead of handing
// SheetJS a truncated zip (cryptic parse error), showing a silently cut CSV,
// or a Code view whose source ends mid-tag while Preview looks complete.
const READ_MAX_BYTES = 8_000_000;

/** Build the html Preview srcdoc: the raw file text with a <base> injected so
 * relative URLs keep resolving against the file's asset URL (what the old
 * src= iframe did). Rendering via srcdoc instead of src is the point: an
 * asset-protocol response carries no CSP of its own, so a src= frame let
 * untrusted markup fetch REMOTE subresources (img/css/font beacons) the
 * moment it was previewed — a srcdoc document inherits the app CSP (local
 * schemes only, connect-src ipc), so it can't phone home. The <base> goes
 * after <head>/<html>/the doctype when present — never before a doctype,
 * which would flip the document into quirks mode. Exported for tests. */
export function htmlPreviewDoc(text: string, baseUrl: string): string {
  const base = `<base href="${baseUrl.replace(/"/g, "%22")}">`;
  const m = /<head[^>]*>/i.exec(text) ?? /<html[^>]*>/i.exec(text) ?? /^\s*<!doctype[^>]*>/i.exec(text);
  if (!m) return base + text;
  const at = m.index + m[0].length;
  return text.slice(0, at) + base + text.slice(at);
}

// per-file SESSION memory for the two small view prefs — PaneTree unmounts the
// surface whenever its tab goes inactive (keyed by tab), so plain state would
// snap back to Preview / fit on every tab switch. Session-scoped and tiny.
const htmlModeMemo = new Map<string, "preview" | "code">();
const imgZoomMemo = new Map<string, "fit" | number>();

export function FileSurface({ paneId, fileId }: { paneId: string; fileId: string }) {
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
  // html files: Preview (sandboxed srcdoc iframe) ⇄ Code (the raw source) —
  // Preview first, and the pick survives tab switches (the session memo)
  const [htmlMode, setHtmlMode] = useState<"preview" | "code">(() => htmlModeMemo.get(fileId) ?? "preview");
  // a read-only sheet/html file past the byte cap: refuse honestly, never half-parse
  const [tooLarge, setTooLarge] = useState(false);
  const [converting, setConverting] = useState(false);
  const [conversionError, setConversionError] = useState("");
  // image zoom: natural px from onLoad, the body's size from a ResizeObserver,
  // and the mode — "fit" (contain, never upscale) or an explicit scale
  const [imgNat, setImgNat] = useState<{ w: number; h: number } | null>(null);
  const [imgZoom, setImgZoom] = useState<"fit" | number>(() => imgZoomMemo.get(fileId) ?? "fit");
  const [bodySize, setBodySize] = useState<{ w: number; h: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const sheetChromeRef = useRef<HTMLDivElement | null>(null);
  const documentChromeRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(1);
  const openMenu = useContextMenu((s) => s.open);
  // the sheet Details panel (decision 2026-07-22, feature D): read-only derived
  // facts, computed lazily when the panel opens — nothing is ever stored
  const [details, setDetails] = useState(false);
  const [detailTables, setDetailTables] = useState<SheetTable[] | null>(null);
  const [detailsErr, setDetailsErr] = useState<string | null>(null);
  const [absPath, setAbsPath] = useState<string | null>(null);
  const [pathCopied, setPathCopied] = useState(false);
  const detailsRef = useRef<HTMLDivElement | null>(null);

  const sheetEditable = kind === "sheet" && sheetKinds.sheetEditableFile(ext, stat);
  const withheld = kind === "sheet" && sheetKinds.workbookWithheld(ext);
  const documentEditable =
    kind === "document" && DOCX_EDITABLE.has(ext) && !!stat?.writable && stat.len <= DOCUMENT_EDIT_MAX_BYTES;

  useEffect(() => {
    let cancelled = false;
    setUrl("");
    setText(null);
    setTables(null);
    setActiveSheet(0);
    setStat(null);
    setProbed(false);
    setErr(null);
    setHtmlMode(htmlModeMemo.get(fileId) ?? "preview");
    setTooLarge(false);
    setConverting(false);
    setConversionError("");
    setImgNat(null);
    setImgZoom(imgZoomMemo.get(fileId) ?? "fit");
    setDetails(false);
    setDetailTables(null);
    setDetailsErr(null);
    setAbsPath(null);
    setPathCopied(false);
    const fail = (e: unknown) => !cancelled && setErr((e as Error)?.message ?? "couldn't load the file");

    // the dropdown's "Open with …" entries — only what's actually installed
    corpusOpenWithApps()
      .then((a) => !cancelled && setApps(a))
      .catch(() => {});

    if (kind === "text") {
      corpusFileText(fileId)
        .then((t) => !cancelled && setText(t))
        .catch(fail);
    } else if (kind === "html") {
      // both modes render the SAME full text (Preview = srcdoc, Code = <pre>),
      // so stat first and refuse past the cap honestly — a capped read would
      // show a source cut mid-tag with no notice. The asset URL only feeds the
      // srcdoc <base> (relative-URL resolution), never the frame itself.
      fileAssetUrl(fileId)
        .then((u) => !cancelled && (u ? setUrl(u) : setErr("couldn't resolve the file")))
        .catch(fail);
      corpusFileStat(fileId)
        .catch(() => null)
        .then((s) => {
          if (cancelled) return;
          if (s && s.len > READ_MAX_BYTES) {
            setTooLarge(true);
            return;
          }
          corpusFileText(fileId, READ_MAX_BYTES)
            .then((t) => !cancelled && setText(t))
            .catch(fail);
        })
        .catch(fail);
    } else if (kind === "sheet" && !sheetKinds.workbookWithheld(ext)) {
      // probe first: an editable sheet mounts the editor (which loads its own
      // data); everything else falls back to the read-only table
      corpusFileStat(fileId)
        .catch(() => null)
        .then((s) => {
          if (cancelled) return;
          setStat(s);
          setProbed(true);
          const editable = sheetKinds.sheetEditableFile(ext, s);
          if (editable) return;
          // past the read cap the bytes arrive truncated — an xlsx dies with a
          // cryptic zip-parse error, a csv shows a silent cut. Refuse up front.
          if (s && s.len > READ_MAX_BYTES) {
            setTooLarge(true);
            return;
          }
          const load = sheetKinds.SHEET_BIN.has(ext)
            ? corpusFileBytes(fileId).then((b64) => parseWorkbook({ base64: b64 }))
            : corpusFileText(fileId, READ_MAX_BYTES).then((csv) =>
                parseWorkbook({ csv, delimiter: ext === "tsv" ? "\t" : "," }),
              );
          load.then((t) => !cancelled && setTables(t)).catch(fail);
        })
        .catch(fail);
    } else if (kind === "document" && DOCX_EDITABLE.has(ext)) {
      // Probe before mounting the editor. Only Rotli-managed storage is a
      // writable lane; linked and secure roots keep their existing policy.
      corpusFileStat(fileId)
        .catch(() => null)
        .then((s) => {
          if (cancelled) return;
          setStat(s);
          setProbed(true);
          if (s && s.len > DOCUMENT_EDIT_MAX_BYTES) setTooLarge(true);
        })
        .catch(fail);
    } else if (kind === "document") {
      // Legacy documents never enter a passive preview. The supported local
      // conversion family gets an explicit copy-to-DOCX action; every other
      // legacy format is labeled unsupported and stays untouched.
      setProbed(true);
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

  // record the two view prefs into the session memo — the surface unmounts on
  // every tab switch, so this is what keeps Code mode / a zoom level sticky
  useEffect(() => {
    htmlModeMemo.set(fileId, htmlMode);
  }, [fileId, htmlMode]);
  useEffect(() => {
    imgZoomMemo.set(fileId, imgZoom);
  }, [fileId, imgZoom]);

  // image zoom: track the body's size so "fit" follows pane resizes
  useEffect(() => {
    if (kind !== "image") return;
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBodySize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [kind]);

  // trackpad pinch — WKWebView delivers it as ctrlKey wheel events. A NATIVE
  // non-passive listener: React registers wheel passive, so preventDefault
  // (stopping the webview's own page zoom) only works this way.
  useEffect(() => {
    if (kind !== "image") return;
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain wheel keeps scroll-pan
      e.preventDefault();
      setImgZoom(clampZoom(scaleRef.current * Math.exp(-e.deltaY * 0.01)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [kind]);

  // svg naturalWidth is already CSS px — no retina halving for vectors
  const imgDpr = ext === "svg" ? 1 : window.devicePixelRatio || 1;
  const imgFit = imgNat && bodySize ? fitScale(imgNat.w, imgNat.h, bodySize.w, bodySize.h, imgDpr) : 1;
  const imgScale = imgZoom === "fit" ? imgFit : imgZoom;
  useEffect(() => {
    scaleRef.current = imgScale;
  }, [imgScale]);

  const onImageKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!e.metaKey || e.altKey || e.ctrlKey) return;
    if (e.key === "=" || e.key === "+") setImgZoom(zoomStep(imgScale, 1));
    else if (e.key === "-") setImgZoom(zoomStep(imgScale, -1));
    else if (e.key === "0") setImgZoom("fit");
    else if (e.key === "1") setImgZoom(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // close the Details panel on outside click or Escape — quiet, keyboard-safe
  useEffect(() => {
    if (!details) return;
    const onDown = (e: MouseEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(e.target as Node)) setDetails(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetails(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [details]);

  const toggleDetails = () => {
    const opening = !details;
    setDetails(opening);
    if (!opening) return;
    setPathCopied(false);
    // the canonical location comes from the corpus router EVERY open — it's the
    // one source that survives filings and renames (never copied anywhere)
    if (isTauri() && absPath === null) {
      corpusNoteAbsolutePath(fileId)
        .then(setAbsPath)
        .catch(() => setAbsPath(null));
    }
    // dims: the read-only viewer already parsed tables; the EDITABLE path never
    // did — inspect lazily now, fresh per surface, bounded by the same caps
    if (tables === null && detailTables === null && !detailsErr) {
      if (stat && stat.len > READ_MAX_BYTES) {
        setDetailsErr("too large to inspect here");
        return;
      }
      const load = sheetKinds.SHEET_BIN.has(ext)
        ? corpusFileBytes(fileId).then((b64) => parseWorkbook({ base64: b64 }))
        : corpusFileText(fileId, READ_MAX_BYTES).then((csv) =>
            parseWorkbook({ csv, delimiter: ext === "tsv" ? "\t" : "," }),
          );
      load
        .then(setDetailTables)
        .catch((e) => setDetailsErr((e as Error)?.message ?? "couldn't inspect the file"));
    }
  };

  const copyPath = () => {
    if (!absPath || !navigator.clipboard) return;
    navigator.clipboard.writeText(absPath).then(
      () => setPathCopied(true),
      () => {},
    );
  };

  const factTables = tables ?? detailTables;
  const facts = factTables ? deriveSheetFacts(ext, factTables) : null;

  const openExternally = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const editingDocument = kind === "document";
    const items: MenuSpec[] = [
      {
        kind: "action",
        label: editingDocument ? "Edit in default app" : "Open with default app",
        onClick: () => void corpusOpenFile(fileId),
      },
      { kind: "action", label: "Reveal in Finder", onClick: () => void corpusRevealFile(fileId) },
    ];
    const withApps = OPEN_WITH_BY_KIND[kind].filter((a) => apps.includes(a));
    if (withApps.length > 0) items.push({ kind: "sep" });
    for (const app of withApps) {
      items.push({
        kind: "action",
        label: editingDocument ? `Edit in ${app}` : `Open with ${app}`,
        onClick: () => void corpusOpenFileWith(fileId, app),
      });
    }
    const r = event.currentTarget.getBoundingClientRect();
    openMenu(r.left, r.bottom + 4, items);
  };

  const convertDocument = async () => {
    if (converting || !DOCUMENT_CONVERTIBLE.has(ext)) return;
    setConverting(true);
    setConversionError("");
    try {
      const { convertDocumentToManagedDocx } = await import("../documents/composition");
      await convertDocumentToManagedDocx(fileId);
    } catch (error) {
      setConversionError(error instanceof Error ? error.message : "Could not create an editable DOCX copy");
    } finally {
      setConverting(false);
    }
  };

  const loadingMedia =
    (kind === "audio" || kind === "video" || kind === "image" || kind === "pdf" || kind === "other") &&
    !url &&
    !err;
  const loadingText = kind === "text" && text === null && !err;
  // Preview needs the text (srcdoc) AND the asset URL (its <base>); Code just the text
  const loadingHtml =
    kind === "html" && !err && !tooLarge && (text === null || (htmlMode === "preview" && !url));
  const loadingSheet =
    kind === "sheet" && !withheld && !err && !tooLarge && (!probed || (!sheetEditable && tables === null));
  const loadingDocument = kind === "document" && DOCX_EDITABLE.has(ext) && !err && !tooLarge && !probed;
  const sheet = tables?.[activeSheet];

  return (
    <div className="file-surface">
      <header className="file-head">
        <span className="file-name" title={name}>
          {name}
        </span>
        {kind === "html" && !tooLarge && (
          <div className="file-mode-tabs" role="tablist" aria-label="View mode">
            <button
              type="button"
              className={htmlMode === "preview" ? "fsh-tab on" : "fsh-tab"}
              onClick={() => setHtmlMode("preview")}
            >
              Preview
            </button>
            <button
              type="button"
              className={htmlMode === "code" ? "fsh-tab on" : "fsh-tab"}
              onClick={() => setHtmlMode("code")}
            >
              Code
            </button>
          </div>
        )}
        {kind === "image" && imgNat && (
          <button
            type="button"
            className="file-dims"
            title="Toggle fit ⇄ actual size (⌘0 fit · ⌘1 100% · ⌘± zoom · pinch)"
            onClick={() => setImgZoom(imgZoom === "fit" ? 1 : "fit")}
          >
            {imgNat.w}×{imgNat.h} · {Math.round(imgScale * 100)}%
          </button>
        )}
        {/* EVERY read-only sheet says WHY editing is off, not just the read-only
            root — .ods/.xls/oversize/failed-probe were silent (#53, audit 2026-07) */}
        {kind === "sheet" && probed && !sheetEditable && !tooLarge && (
          <span className="file-readonly" title={sheetKinds.sheetReadOnlyReason(stat, ext).title}>
            {sheetKinds.sheetReadOnlyReason(stat, ext).label}
          </span>
        )}
        {kind === "sheet" && sheetEditable && <div ref={sheetChromeRef} className="file-sheet-chrome" />}
        {kind === "document" && documentEditable && (
          <div ref={documentChromeRef} className="file-document-chrome" />
        )}
        {kind === "document" && probed && DOCX_EDITABLE.has(ext) && !documentEditable && !tooLarge && (
          <span className="file-readonly" title="Move this document into Assets to edit it locally.">
            read-only location
          </span>
        )}
        {kind === "pdf" && (
          <button
            type="button"
            className="file-open-ext file-convert-pdf"
            title="Create a new editable DOCX copy locally; the PDF stays unchanged"
            disabled={converting}
            onClick={() => void convertDocument()}
          >
            {converting ? "Converting…" : "Convert to DOCX"}
          </button>
        )}
        {kind === "sheet" && (
          <div className="file-details" ref={detailsRef}>
            <button
              type="button"
              className="file-open-ext"
              aria-expanded={details}
              aria-haspopup="dialog"
              title="File facts — location, size, dates, format, and sheet dimensions"
              onClick={toggleDetails}
            >
              Details <span aria-hidden="true">▾</span>
            </button>
            {details && (
              <div className="file-details-pop" role="dialog" aria-label="File details">
                <dl className="fdp-list">
                  <dt>Name</dt>
                  <dd className="fdp-clip" title={name}>
                    {name}
                  </dd>
                  <dt>Where</dt>
                  <dd className="fdp-clip" title={absPath ?? undefined}>
                    {absPath ?? "—"}
                  </dd>
                  <dt>Size</dt>
                  <dd>{sizeLine(stat)}</dd>
                  <dt>Created</dt>
                  <dd>{formatStamp(stat?.createdMs)}</dd>
                  <dt>Modified</dt>
                  <dd>{formatStamp(stat?.modifiedMs)}</dd>
                  <dt>Format</dt>
                  <dd>
                    {facts
                      ? facts.delimiter
                        ? `${facts.format} · ${facts.delimiter}-separated · ${facts.encoding}`
                        : facts.format
                      : detailsErr
                        ? "—"
                        : "Inspecting…"}
                  </dd>
                </dl>
                {facts && (
                  <ul className="fdp-sheets">
                    {facts.sheets.map((s) => (
                      <li key={s.name}>
                        {facts.sheets.length > 1 && <span className="fdp-sheet-name">{s.name}</span>}
                        {describeShape(s)}
                      </li>
                    ))}
                  </ul>
                )}
                {detailsErr && <p className="fdp-note">⚠ {detailsErr}</p>}
                {absPath && (
                  <button type="button" className="file-open-ext fdp-copy" onClick={copyPath}>
                    {pathCopied ? "Copied" : "Copy path"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          className="file-open-ext"
          title={
            kind === "document"
              ? "Open in another document app, choose an app, or reveal in Finder"
              : "Open in the default app / reveal in Finder / open with…"
          }
          onClick={openExternally}
        >
          Open externally <span aria-hidden="true">▾</span>
        </button>
      </header>
      {kind === "pdf" && conversionError && (
        <div className="file-conversion-banner" role="alert">
          {conversionError}
        </div>
      )}

      <div
        ref={bodyRef}
        className={
          kind === "sheet" && !tooLarge
            ? "file-body file-body-sheet"
            : kind === "image" ||
                kind === "pdf" ||
                kind === "other" ||
                kind === "document" ||
                (kind === "html" && htmlMode === "preview" && !tooLarge)
              ? "file-body file-body-fill"
              : "file-body"
        }
        // the image body takes focus (it's a scroll container anyway) so the
        // ⌘±/⌘0/⌘1 zoom keys land here, scoped to THIS pane — no global listener
        tabIndex={kind === "image" ? 0 : undefined}
        onKeyDown={kind === "image" ? onImageKeyDown : undefined}
        onMouseDown={kind === "image" ? (e) => e.currentTarget.focus() : undefined}
      >
        {err && <p className="file-err">⚠ {err}</p>}
        {(loadingMedia || loadingText || loadingHtml || loadingSheet || loadingDocument) && (
          <p className="file-loading">Loading…</p>
        )}

        {!err && kind === "audio" && url && (
          <div className="file-audio-wrap">
            <audio className="file-audio" controls preload="metadata" src={url} />
          </div>
        )}
        {!err && kind === "video" && url && (
          <video className="file-video" controls preload="metadata" src={url} />
        )}
        {/* image: a grid wrap centers it; overflow:auto on the body pans once it
            outgrows the pane. "fit" never upscales (small images stay crisp);
            an svg without intrinsic dims keeps the old fill-the-pane behavior. */}
        {!err && kind === "image" && url && (
          <div className="file-image-wrap">
            <img
              className={imgNat ? "file-image" : "file-image fill"}
              src={url}
              alt={name}
              onLoad={(e) => {
                const el = e.currentTarget;
                if (el.naturalWidth > 0 && el.naturalHeight > 0)
                  setImgNat({ w: el.naturalWidth, h: el.naturalHeight });
              }}
              style={
                imgNat
                  ? {
                      width: (imgNat.w / imgDpr) * imgScale,
                      maxWidth: "none",
                      maxHeight: "none",
                      // past ~2× a photo blurs either way — keep pixel art crisp
                      imageRendering: imgScale > 2 ? "pixelated" : undefined,
                    }
                  : undefined
              }
            />
          </div>
        )}
        {/* pdf: WKWebView's built-in viewer in the frame. Focus treatment (#54,
            audit 2026-07): the frame takes focus when it loads (and via Tab),
            so space/arrows page the document without a blind click first. The
            real pdf.js viewer (pages/zoom/search) is a deferred feature project. */}
        {!err && kind === "pdf" && url && (
          <iframe
            className="file-pdf"
            title={name}
            src={url}
            tabIndex={0}
            onLoad={(e) => {
              // …but never steal focus from live typing in another pane
              const ae = document.activeElement as HTMLElement | null;
              const typing =
                ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");
              if (!typing) e.currentTarget.focus();
            }}
          />
        )}
        {!err && kind === "text" && text !== null && (
          <pre className="file-text">{text || "(empty file)"}</pre>
        )}

        {!err && kind === "document" && probed && documentEditable && (
          <Suspense fallback={<p className="file-loading">Opening editor…</p>}>
            <DocumentEditor key={fileId} fileId={fileId} paneId={paneId} chromeSlotRef={documentChromeRef} />
          </Suspense>
        )}
        {!err &&
          kind === "document" &&
          probed &&
          DOCX_EDITABLE.has(ext) &&
          !documentEditable &&
          !tooLarge && (
            <div className="file-document-fallback">
              <p>This document is in a protected location. Move it into Assets to edit it.</p>
            </div>
          )}
        {!err && kind === "document" && probed && !DOCX_EDITABLE.has(ext) && (
          <div className="file-document-fallback">
            {DOCUMENT_CONVERTIBLE.has(ext) ? (
              <>
                <h2>Convert a copy to edit here</h2>
                <p>
                  Rotli can use the local macOS document converter for .{ext}. It creates a new managed DOCX
                  in Assets and leaves the original unchanged.
                </p>
                <button
                  type="button"
                  className="file-convert-document"
                  disabled={converting}
                  onClick={() => void convertDocument()}
                >
                  {converting ? "Converting…" : "Convert copy to DOCX"}
                </button>
                {conversionError && (
                  <p className="file-conversion-error" role="alert">
                    {conversionError}
                  </p>
                )}
                <p className="file-conversion-note">
                  Complex layout, embedded objects, and legacy fields may need review after conversion.
                </p>
              </>
            ) : (
              <>
                <h2>.{ext || "unknown"} is unsupported</h2>
                <p>
                  Rotli does not have a faithful local conversion path for this format. Open the original
                  externally and export a DOCX copy to edit it in Rotli.
                </p>
              </>
            )}
          </div>
        )}

        {/* html Preview: a SANDBOXED srcdoc iframe, same model as the ```html
            fence (blockRender.ts). srcdoc — never src over the asset protocol:
            an asset response carries no CSP, so a src= frame let untrusted
            markup load REMOTE subresources (img/css/font beacons) on open; a
            srcdoc document inherits the app CSP (local schemes only) and the
            empty sandbox (opaque origin, no scripts) refuses the rest. The
            injected <base> keeps relative URLs resolving like the old src=
            frame did (htmlPreviewDoc). Never loosen the sandbox — a .html in
            the notes folder is untrusted the moment anything is shared. */}
        {!err && kind === "html" && !tooLarge && htmlMode === "preview" && text !== null && url && (
          <iframe className="file-html" title={name} sandbox="" srcDoc={htmlPreviewDoc(text, url)} />
        )}
        {!err && kind === "html" && !tooLarge && htmlMode === "code" && text !== null && (
          <pre className="file-text">{text || "(empty file)"}</pre>
        )}

        {withheld && (
          <div className="file-document-fallback">
            <h2>.{ext} is unsupported in this build</h2>
            <p>
              Spreadsheets aren’t available in this build yet. Open the original externally, or save a CSV
              copy to edit it in Rotli.
            </p>
          </div>
        )}
        {!err && kind === "sheet" && probed && sheetEditable && (
          <Suspense fallback={<p className="file-loading">Loading…</p>}>
            <SheetEditor
              key={fileId}
              fileId={fileId}
              paneId={paneId}
              mode={ext === "csv" ? "csv" : "xlsx"}
              chromeSlotRef={sheetChromeRef}
            />
          </Suspense>
        )}

        {!err && tooLarge && (
          <p className="file-loading">
            {kind === "document"
              ? "This document is too large to edit safely in Rotli — open it externally instead."
              : "this file is too large to view in rotli — Open externally shows the whole thing"}
          </p>
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
            {sheet?.truncated && (
              <div className="file-sheet-note">
                showing the first {sheet.rows.length.toLocaleString()} rows — Open externally for the rest
              </div>
            )}
            <div className="file-sheet-scroll">
              {sheet && sheet.rows.length > 0 ? (
                <table className="file-table">
                  <tbody>
                    {sheet.rows.map((row, ri) => (
                      <tr key={ri}>
                        {/* the header row's rownum is the CORNER — pinned on both axes */}
                        <td className={ri === 0 ? "fsh-rownum fsh-corner" : "fsh-rownum"}>{ri + 1}</td>
                        {row.map((cell, ci) =>
                          // title: clipped cells (nowrap + ellipsis) reveal on hover —
                          // the read-only grid has no edit mode to peek into
                          ri === 0 ? (
                            <th key={ci} title={cell || undefined}>
                              {cell}
                            </th>
                          ) : (
                            <td key={ci} title={cell || undefined}>
                              {cell}
                            </td>
                          ),
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
