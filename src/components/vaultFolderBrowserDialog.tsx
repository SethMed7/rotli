import { useEffect, useId, useRef, useState } from "react";

import {
  type VaultBrowserView,
  corpusInspectFolder,
  memexPickFolder,
  vaultBrowserCancel,
  vaultBrowserCreateFolder,
  vaultBrowserGoBack,
  vaultBrowserOpenChild,
  vaultBrowserRefresh,
  vaultBrowserReveal,
  vaultBrowserSelect,
  vaultBrowserSelectChild,
  vaultBrowserStart,
} from "../lib/tauri";
import { completeVaultFolderRequest, useVaultFolderBrowserStore } from "../state/vaultFolderBrowser";
import { ChevronRight, FolderGlyph, NewFolderGlyph } from "./glyphs";

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function VaultFolderBrowser() {
  const pending = useVaultFolderBrowserStore((state) => state.pending);
  const [view, setView] = useState<VaultBrowserView | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!pending) {
      setView(null);
      return;
    }
    let live = true;
    setView(null);
    setError(null);
    setCreating(false);
    setFolderName("");
    setWorking(true);
    void vaultBrowserStart(pending.requireEmpty)
      .then((next) => {
        if (!live) return;
        setView(next);
        setSelectedIndex(-1);
        requestAnimationFrame(() => panelRef.current?.focus());
      })
      .catch((cause: unknown) => {
        if (live) setError(messageOf(cause));
      })
      .finally(() => {
        if (live) setWorking(false);
      });
    return () => {
      live = false;
    };
  }, [pending]);

  if (!pending) return null;

  const applyView = (next: VaultBrowserView) => {
    setView(next);
    setSelectedIndex(-1);
    setCreating(false);
    setFolderName("");
    setError(null);
  };

  const run = async (operation: () => Promise<VaultBrowserView>) => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      applyView(await operation());
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setWorking(false);
    }
  };

  const cancel = async () => {
    if (working) return;
    setWorking(true);
    try {
      await vaultBrowserCancel();
    } catch {
      // Closing the UI still settles the caller if the native session already
      // disappeared (for example after a development hot reload).
    }
    completeVaultFolderRequest(pending.id, null);
  };

  const choose = async () => {
    const selected = view?.directories[selectedIndex];
    if (working || !view || (!selected && !view.canSelect)) return;
    setWorking(true);
    setError(null);
    try {
      const path = selected ? await vaultBrowserSelectChild(selected.name) : await vaultBrowserSelect();
      completeVaultFolderRequest(pending.id, path);
    } catch (cause) {
      setError(messageOf(cause));
      setWorking(false);
    }
  };

  const chooseWithSystemPicker = async () => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const path = await memexPickFolder();
      if (!path) return;
      if (pending.requireEmpty && (await corpusInspectFolder(path)).kind !== "empty") {
        throw new Error("Choose an empty folder for a new vault.");
      }
      await vaultBrowserCancel();
      completeVaultFolderRequest(pending.id, path);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setWorking(false);
    }
  };

  const openSelected = () => {
    const entry = view?.directories[selectedIndex];
    if (entry) void run(() => vaultBrowserOpenChild(entry.name));
  };

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name || working) return;
    await run(() => vaultBrowserCreateFolder(name));
  };

  const moveSelection = (delta: number) => {
    if (!view?.directories.length) return;
    const next =
      selectedIndex < 0
        ? delta > 0
          ? 0
          : view.directories.length - 1
        : (selectedIndex + delta + view.directories.length) % view.directories.length;
    setSelectedIndex(next);
    rowRefs.current[next]?.focus();
  };

  const trapTab = (event: React.KeyboardEvent) => {
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
      ) ?? [],
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Tab") {
      trapTab(event);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      void cancel();
      return;
    }
    if (creating || event.target instanceof HTMLInputElement) return;
    if (event.key === "Backspace" && view?.canGoBack) {
      event.preventDefault();
      void run(vaultBrowserGoBack);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      openSelected();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void choose();
    }
  };

  return (
    <div
      className="vault-browser-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void cancel();
      }}
    >
      <div
        ref={panelRef}
        className="vault-browser-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="vault-browser-head">
          <div className="vault-browser-heading">
            <span className="vault-browser-eyebrow">Local files</span>
            <h2 id={titleId}>{pending.title}</h2>
            <p id={descriptionId}>{pending.description}</p>
          </div>
          <button
            type="button"
            className="vault-browser-close"
            aria-label="Cancel"
            onClick={() => void cancel()}
          >
            Esc
          </button>
        </header>

        <div className="vault-browser-location">
          <button
            type="button"
            className="vault-browser-back"
            aria-label="Go to parent folder"
            disabled={working || !view?.canGoBack}
            onClick={() => void run(vaultBrowserGoBack)}
          >
            <ChevronRight size={12} />
          </button>
          <div className="vault-browser-path">
            <strong>{view?.displayPath ?? "Opening Home…"}</strong>
            <span>{view?.absolutePath ?? "Your Home folder"}</span>
          </div>
          <button
            type="button"
            className="vault-browser-refresh"
            disabled={working || !view}
            onClick={() => void run(vaultBrowserRefresh)}
          >
            Refresh
          </button>
        </div>

        <div className="vault-browser-list" role="listbox" aria-label="Directories" aria-busy={working}>
          {working && !view ? (
            <div className="vault-browser-status">Opening your Home folder…</div>
          ) : error && !view ? (
            <div className="vault-browser-status error">{error}</div>
          ) : view?.directories.length ? (
            view.directories.map((directory, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                className={index === selectedIndex ? "vault-browser-row selected" : "vault-browser-row"}
                key={directory.name}
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                onClick={() => setSelectedIndex(index)}
                onDoubleClick={() => void run(() => vaultBrowserOpenChild(directory.name))}
              >
                <FolderGlyph size={17} />
                <span>{directory.name}</span>
                <ChevronRight size={11} />
              </button>
            ))
          ) : (
            <div className="vault-browser-status">
              <FolderGlyph size={24} />
              <span>{view?.canSelect ? "This folder is ready." : "No visible folders here."}</span>
            </div>
          )}
        </div>

        {creating && (
          <form
            className="vault-browser-create"
            onSubmit={(event) => {
              event.preventDefault();
              void createFolder();
            }}
          >
            <label htmlFor={`${titleId}-folder-name`}>New folder name</label>
            <div>
              <input
                id={`${titleId}-folder-name`}
                value={folderName}
                autoFocus
                spellCheck={false}
                onChange={(event) => setFolderName(event.target.value)}
              />
              <button type="submit" className="ghostbtn primary" disabled={!folderName.trim() || working}>
                Create
              </button>
              <button type="button" className="ghostbtn" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {(error || view?.selectDisabledReason) && (
          <p
            className={error ? "vault-browser-reason error" : "vault-browser-reason"}
            role={error ? "alert" : undefined}
          >
            {error ?? view?.selectDisabledReason}
          </p>
        )}

        <footer className="vault-browser-foot">
          <div className="vault-browser-tools">
            <button
              type="button"
              className="ghostbtn"
              disabled={working || !view}
              onClick={() => setCreating(true)}
            >
              <NewFolderGlyph size={14} />
              New folder
            </button>
            <button
              type="button"
              className="ghostbtn quiet"
              disabled={working || !view}
              onClick={() => void vaultBrowserReveal()}
            >
              Open in Finder
            </button>
            <button
              type="button"
              className="ghostbtn quiet"
              disabled={working}
              onClick={() => void chooseWithSystemPicker()}
            >
              More locations…
            </button>
          </div>
          <div className="vault-browser-actions">
            <button type="button" className="ghostbtn" disabled={working} onClick={() => void cancel()}>
              Cancel
            </button>
            <button
              type="button"
              className="ghostbtn primary"
              disabled={working || (!view?.canSelect && selectedIndex < 0)}
              onClick={() => void choose()}
            >
              {pending.actionLabel}
            </button>
          </div>
        </footer>

        <div className="vault-browser-hints" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>Enter</kbd> Choose folder
          </span>
          <span>
            <kbd>→</kbd> Open folder
          </span>
          <span>
            <kbd>Backspace</kbd> Back
          </span>
          <span>
            <kbd>Esc</kbd> Cancel
          </span>
        </div>
      </div>
    </div>
  );
}
