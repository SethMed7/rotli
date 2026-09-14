// Thin React shell for editable DOCX files. React owns lifecycle, save status,
// and keyboard scope; Univer and OOXML remain behind documents/ adapters.

import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { editManagedDocument } from "../documents/composition";
import { markDocumentDraftChanged } from "../documents/draftComposition";
import { documentFormatHandle } from "../documents/engine/format";
import type { DocumentEngineHandle } from "../documents/engine/univer";
import type { EditableDocument } from "../documents/model";
import {
  deleteParkedDocument,
  getParkedDocument,
  registerLiveDocument,
  setParkedDocument,
  unregisterLiveDocument,
  type ReadyDocumentSession,
} from "../documents/session";
import { registerEditor, unregisterEditor } from "../editor/commands";
import { corpusFileStat } from "../lib/tauri";
import { invalidateNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";

export default function DocumentEditor({
  fileId,
  paneId,
  compact = false,
  chromeSlotRef,
}: {
  fileId: string;
  paneId?: string;
  compact?: boolean;
  chromeSlotRef?: RefObject<HTMLElement | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ReadyDocumentSession | null>(null);
  const handleRef = useRef<DocumentEngineHandle | null>(null);
  const diskLenRef = useRef(0);
  const diskRevisionRef = useRef("");
  const dirtyGenRef = useRef(0);
  const armedRef = useRef(false);
  const pendingEngineDisposeRef = useRef<Promise<void>>(Promise.resolve());
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [chromeEl, setChromeEl] = useState<HTMLElement | null>(null);
  const [engineRevision, setEngineRevision] = useState(0);

  useEffect(() => {
    setChromeEl(chromeSlotRef?.current ?? null);
  }, [chromeSlotRef]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let disposeEngine: (() => void) | null = null;
    const previousEngineDisposal = pendingEngineDisposeRef.current;
    armedRef.current = false;
    setReady(false);
    setErr(null);

    void (async () => {
      try {
        // Univer owns a nested React root. A structural remount waits for the
        // prior root's deferred teardown so two engines never share this host.
        await previousEngineDisposal;
        if (disposed) return;
        const stat = await corpusFileStat(fileId);
        if (!stat?.writable) throw new Error("This document is in a read-only location.");
        diskLenRef.current = stat.len;
        diskRevisionRef.current = stat.revision;

        let park = getParkedDocument(fileId);
        if (park && park.diskRevision !== stat.revision) {
          deleteParkedDocument(fileId);
          park = undefined;
        }

        let session: ReadyDocumentSession;
        let model: EditableDocument;
        if (park) {
          session = park.session;
          model = park.document;
          dirtyGenRef.current = Math.max(1, park.dirtyGen);
          setDirty(true);
          setWarnings(session.warnings);
          diskRevisionRef.current = park.diskRevision;
        } else {
          const outcome = await editManagedDocument(fileId);
          if (outcome.kind === "too-large") {
            throw new Error("This document is too large to edit safely in Rotli.");
          }
          session = outcome;
          model = outcome.document;
          dirtyGenRef.current = 0;
          setDirty(false);
          setWarnings(outcome.warnings);
        }
        if (disposed) return;
        sessionRef.current = session;

        const { mountDocumentEditor } = await import("../documents/engine/univer");
        if (disposed) return;
        const handle = mountDocumentEditor(host, model);
        handleRef.current = handle;
        const subscription = handle.onDirty(() => {
          if (!armedRef.current) return;
          markDocumentDraftChanged(fileId);
          dirtyGenRef.current += 1;
          setDirty(true);
        });
        const structureSubscription = handle.onStructureChange(() => {
          if (!disposed) setEngineRevision((revision) => revision + 1);
        });
        // editor.* format actions resolve through the focused pane's handle;
        // an embed has no pane and keeps Univer's in-canvas shortcuts only
        const formatHandle = documentFormatHandle((id) => handle.runCommand(id));
        if (paneId) registerEditor(paneId, formatHandle);
        disposeEngine = () => {
          if (paneId) unregisterEditor(paneId, formatHandle);
          if (subscription && typeof subscription === "object") subscription.dispose?.();
          structureSubscription.dispose();
          handle.dispose();
        };
        await handle.ready;
        if (disposed) return;
        // Univer can emit setup mutations while mounting. Only user-visible
        // edits after ready make a new document durable.
        armedRef.current = true;
        setReady(true);
      } catch (error) {
        if (!disposed) setErr(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      disposed = true;
      unregisterLiveDocument(fileId);
      try {
        const session = sessionRef.current;
        const handle = handleRef.current;
        if (session && handle && dirtyGenRef.current > 0) {
          setParkedDocument(fileId, {
            session,
            document: handle.save(),
            diskLen: diskLenRef.current,
            diskRevision: diskRevisionRef.current,
            dirtyGen: dirtyGenRef.current,
          });
        }
      } catch {
        /* an editor teardown must never block tab or theme changes */
      }
      if (disposeEngine) {
        const dispose = disposeEngine;
        // React refuses a synchronous nested-root unmount while it is committing
        // this component's cleanup. Move the vendor teardown past that commit;
        // the next mount awaits it above before touching the same host.
        pendingEngineDisposeRef.current = new Promise((resolve) => {
          window.setTimeout(() => {
            try {
              dispose();
            } catch {
              // Teardown must release the tab even if Univer has already
              // disposed one of its RxJS services during hot replacement.
            } finally {
              resolve();
            }
          }, 0);
        });
      }
      handleRef.current = null;
      sessionRef.current = null;
    };
  }, [engineRevision, fileId, paneId]);

  useEffect(() => {
    const session = sessionRef.current;
    const handle = handleRef.current;
    if (!dirty || !session || !handle) {
      unregisterLiveDocument(fileId);
      return;
    }
    const entry: Parameters<typeof registerLiveDocument>[0] = {
      fileId,
      session,
      snapshot: () => handle.save(),
      diskLen: diskLenRef.current,
      diskRevision: diskRevisionRef.current,
      dirtyGen: () => dirtyGenRef.current,
      onFlushed: (generation) => {
        if (dirtyGenRef.current === generation) {
          diskRevisionRef.current = entry.diskRevision;
          dirtyGenRef.current = 0;
          setDirty(false);
          deleteParkedDocument(fileId);
          unregisterLiveDocument(fileId);
        }
      },
    };
    registerLiveDocument(entry);
    return () => unregisterLiveDocument(fileId);
  }, [dirty, fileId, ready]);

  const save = async () => {
    const session = sessionRef.current;
    const handle = handleRef.current;
    if (!session || !handle || saving || dirtyGenRef.current === 0) return;
    const generation = dirtyGenRef.current;
    setSaving(true);
    setErr(null);
    try {
      diskRevisionRef.current = await session.save(handle.save());
      const stat = await corpusFileStat(fileId).catch(() => null);
      if (stat) diskLenRef.current = stat.len;
      if (dirtyGenRef.current === generation) {
        dirtyGenRef.current = 0;
        setDirty(false);
        deleteParkedDocument(fileId);
        unregisterLiveDocument(fileId);
      }
      void invalidateNotes();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "s") return;
      const inThisEmbed = compact && !!hostRef.current?.contains(document.activeElement);
      const inThisPane = !!paneId && usePanesStore.getState().focusedPaneId === paneId;
      if (!inThisEmbed && !inThisPane) return;
      event.preventDefault();
      event.stopPropagation();
      void saveRef.current();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [compact, paneId]);

  const chrome = (
    <div className="document-chrome-actions">
      {warnings.length > 0 && (
        <span className="document-preserved" title={warnings.join("\n")}>
          Complex content preserved
        </span>
      )}
      {err && (
        <span className="document-save-error" role="alert">
          {err}
        </span>
      )}
      {dirty && !saving && <span className="document-dirty" title="Unsaved changes" />}
      <button
        type="button"
        className="document-save"
        disabled={!ready || saving || !dirty}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : dirty ? "Save ⌘S" : "Saved"}
      </button>
    </div>
  );

  return (
    <div className={compact ? "document-editor compact" : "document-editor"}>
      {chromeEl ? createPortal(chrome, chromeEl) : <div className="document-editor-bar">{chrome}</div>}
      {!err && !ready && (
        <p className="file-loading" role="status">
          Opening editor…
        </p>
      )}
      {err && !ready && (
        <p className="file-err" role="alert">
          {err}
        </p>
      )}
      <div
        ref={hostRef}
        className={ready ? "document-editor-host is-ready" : "document-editor-host"}
        aria-hidden={!ready}
      />
    </div>
  );
}
