// The Univer sheet surface (P2 of the engine adoption — decision 2026-07-09):
// Univer's FREE Apache-2.0 preset is the xlsx interaction surface; exceljs
// stays the DISK CODEC. Load: exceljs → the P1 bridge's full projection
// (values/formulas/styles/merges/sizes/freeze/numFmt). Save (⌘S / button):
// fWorkbook.save() snapshot → applySnapshotToWorkbook MUTATES the retained
// exceljs Workbook (unmodeled features survive) → writeBuffer →
// corpus_write_file_bytes with the one-time .bak. Explicit save only — the
// same law as SheetEditor: a binary rewrite never autosaves on keystrokes.
// Dirty edits PARK per file across tab switches (PaneTree unmounts inactive
// tabs); a clean mount always reloads disk truth. Still labeled beta while it
// soaks; the old editor remains one toggle away. Never any @univerjs-pro/*.

import { useEffect, useRef, useState } from "react";
import { LocaleType, createUniver, merge } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import ExcelJS from "exceljs";
import type { Workbook } from "exceljs";
import { corpusFileBytes, corpusFileStat, corpusWriteFileBytes } from "../lib/tauri";
import { b64FromBytes, bytesFromB64 } from "../lib/sheetEdit";
import {
  type USnapshot,
  applySnapshotToWorkbook,
  buildSheetIdMap,
  workbookToUniverData,
} from "../lib/univerBridge";
import { invalidateNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";

/** Structural facade shapes — the runtime objects carry far more; we depend
 * only on what we call, so Univer's 0.x type churn can't reach us here. */
interface FWorkbookLike {
  save: () => unknown;
}
interface CommandInfoLike {
  id?: string;
  /** Univer CommandType: 0 operation (UI state) · 1 mutation (real edits) · 2 command */
  type?: number;
}

/** A DIRTY session parked across tab switches — the retained codec workbook,
 * the latest Univer snapshot, the live sheet-id registry, and the on-disk byte
 * length AT LOAD TIME. The length is the staleness sentinel (reviewer S1): if
 * the disk file changed while the session was parked (a classic-editor save,
 * an external writer), resuming the park would clobber that newer truth — so
 * a mismatched park is DROPPED and disk wins. */
interface ParkedUniver {
  wb: Workbook;
  snapshot: USnapshot;
  idMap: Map<string, number>;
  diskLen: number;
}
const parked = new Map<string, ParkedUniver>();

function isDarkTheme(): boolean {
  const t = document.documentElement.dataset.theme ?? "light";
  return t === "dark" || t === "charcoal" || t === "glass-dark";
}

export default function UniverSpike({ fileId, paneId }: { fileId: string; paneId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const wbRef = useRef<Workbook | null>(null);
  const fWorkbookRef = useRef<FWorkbookLike | null>(null);
  const idMapRef = useRef<Map<string, number>>(new Map());
  // the on-disk byte length this session is based on — the park staleness sentinel
  const diskLenRef = useRef(0);
  // mutations fired while the workbook is still materializing must not read as
  // user edits — armed right after createWorkbook returns (reviewer S2: a timer
  // window let a fast first edit slip through UNparked; immediate arming can
  // only over-detect, which the save/park guards tolerate)
  const armedRef = useRef(false);
  // save() clears dirty only when no edit landed while the write was in flight
  const dirtyGen = useRef(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let dispose: (() => void) | null = null;

    void (async () => {
      try {
        // a parked DIRTY session resumes ONLY when the disk file is unchanged
        // since it was parked (reviewer S1) — otherwise disk truth wins
        let park = parked.get(fileId);
        if (park) {
          const stat = await corpusFileStat(fileId).catch(() => null);
          if (!stat || stat.len !== park.diskLen) {
            parked.delete(fileId);
            park = undefined;
            if (!disposed)
              setNote("the file changed on disk — unsaved engine edits from the earlier session were set aside");
          }
        }
        let wb: Workbook;
        let data: USnapshot;
        if (park) {
          wb = park.wb;
          data = park.snapshot;
          idMapRef.current = park.idMap;
          diskLenRef.current = park.diskLen;
          dirtyGen.current = Math.max(1, dirtyGen.current); // a resumed park IS dirty
          setDirty(true);
        } else {
          const b64 = await corpusFileBytes(fileId);
          const bytes = bytesFromB64(b64);
          diskLenRef.current = bytes.length;
          wb = new ExcelJS.Workbook();
          await wb.xlsx.load(bytes.buffer as ArrayBuffer);
          data = workbookToUniverData(wb, fileId);
          idMapRef.current = buildSheetIdMap(wb, data);
        }
        if (disposed) return;
        wbRef.current = wb;

        const { univer, univerAPI } = createUniver({
          locale: LocaleType.EN_US,
          locales: { [LocaleType.EN_US]: merge({}, UniverPresetSheetsCoreEnUS) },
          darkMode: isDarkTheme(),
          presets: [UniverSheetsCorePreset({ container: host })],
        });
        const fwb = univerAPI.createWorkbook({
          ...data,
          locale: LocaleType.EN_US,
        } as unknown as Parameters<typeof univerAPI.createWorkbook>[0]) as unknown as FWorkbookLike;
        fWorkbookRef.current = fwb;

        // real edits are MUTATIONS (type 1); operations (selection/scroll) are
        // UI state. Over-detection is harmless (Save is idempotent), under-
        // detection can't lose data (the button never disables while ready).
        const api = univerAPI as unknown as {
          onCommandExecuted?: (cb: (c: CommandInfoLike) => void) => { dispose?: () => void } | void;
        };
        const sub = api.onCommandExecuted?.((c) => {
          if (!armedRef.current || c.type !== 1) return;
          dirtyGen.current += 1;
          setDirty(true);
        });
        armedRef.current = true; // creation mutations fired inside createUniver/createWorkbook

        dispose = () => {
          if (sub && typeof sub === "object" && typeof sub.dispose === "function") sub.dispose();
          univer.dispose();
        };
        setReady(true);
      } catch (e) {
        if (!disposed) setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      // park a dirty session (snapshot BEFORE dispose) so a tab peek can't
      // discard edits; clean sessions just dispose (next mount reloads disk)
      try {
        const wb = wbRef.current;
        const fwb = fWorkbookRef.current;
        if (wb && fwb && dirtyGen.current > 0) {
          parked.set(fileId, {
            wb,
            snapshot: fwb.save() as USnapshot,
            idMap: idMapRef.current,
            diskLen: diskLenRef.current,
          });
        }
      } catch {
        /* a failed park must never block unmount */
      }
      dispose?.();
      fWorkbookRef.current = null;
      wbRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const save = async () => {
    const wb = wbRef.current;
    const fwb = fWorkbookRef.current;
    if (!wb || !fwb || saving) return;
    // a CLEAN save is a no-op (reviewer B1): every apply degrades unmodeled
    // cell features (hyperlinks, comments flatten), so never rewrite the file
    // when nothing changed
    if (!dirty && dirtyGen.current === 0) return;
    const gen = dirtyGen.current;
    setSaving(true);
    setErr(null);
    try {
      const snapshot = fwb.save() as USnapshot;
      applySnapshotToWorkbook(wb, snapshot, idMapRef.current); // guards malformed snapshots itself
      const buffer = await wb.xlsx.writeBuffer();
      const bytes = new Uint8Array(buffer);
      // bak=true: the pre-rotli original survives the first engine save
      await corpusWriteFileBytes(fileId, b64FromBytes(bytes), true);
      diskLenRef.current = bytes.length; // this session now matches disk again
      if (dirtyGen.current === gen) {
        dirtyGen.current = 0;
        setDirty(false);
        parked.delete(fileId);
      }
      void invalidateNotes();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // ⌘S — Univer's canvas owns keyboard focus, so listen at the window (capture)
  // but act ONLY when THIS pane is the focused one (reviewer B1: an app-wide
  // grab swallowed the ⌘S of a note or classic sheet in a neighboring pane).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "s") return;
      if (usePanesStore.getState().focusedPaneId !== paneId) return;
      e.preventDefault();
      e.stopPropagation();
      void saveRef.current();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [paneId]);

  return (
    <div className="univer-spike">
      <div className="univer-spike-note" role="note">
        <span>
          Univer engine · <b>beta</b> — full Excel grammar; <b>⌘S saves</b> to your file (a one-time
          .bak keeps the original).
        </span>
        <span className="univer-spike-space" />
        {err && <span className="sheet-save-err">⚠ {err}</span>}
        {!err && note && <span className="sheet-save-err">{note}</span>}
        {dirty && !saving && <span className="sheet-dirty" title="Unsaved changes" />}
        <button
          type="button"
          className="sheet-save"
          disabled={saving || !ready}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : dirty ? "Save ⌘S" : "Saved"}
        </button>
      </div>
      {!err && !ready && <p className="file-loading">Loading the engine…</p>}
      <div ref={hostRef} className="univer-spike-host" />
    </div>
  );
}
