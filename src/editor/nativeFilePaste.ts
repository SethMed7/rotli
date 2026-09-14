// Finder ⌘C → ⌘V into a note or a chat. WKWebView delivers a copied Finder
// file to the page as only its NAME in text/plain: a chat pasted the name as
// text and a note did nothing. The host checks the pasteboard for file
// references (types only) whenever the window gains focus — a Finder copy
// always happens with another app focused — so the paste can be classified
// synchronously; the files themselves come from the host with the same
// one-shot import grants as a drop and land through the same delivery.

import { EditorView } from "@codemirror/view";
import { useEffect } from "react";

import { chatDropAt } from "../components/chat/chatDrop";
import {
  clipboardFilePaths,
  clipboardHasFiles,
  corpusCreateImageAsset,
  isTauri,
  rootIdOf,
} from "../lib/tauri";
import { invalidateNotes } from "../services/hooks";
import { showFileNotice } from "../state/fileNotice";
import { classifyPaste, emptyPasteOutcome, type PasteFiles } from "./dropRouting";
import { importImageFilesAtPosition, isImagePath } from "./externalImageDrop";
import { deliverFiles, type FileTarget } from "./fileDelivery";
import { noteIdFacet } from "./livePreview";

const COPY_AGAIN = "Couldn’t paste the copied file — copy it again in Finder, then paste";

type PasteTarget = Exclude<FileTarget, { kind: "none" }>;

/** A chat composer or a note body; any other field keeps its ordinary paste. */
function pasteTarget(element: Element): PasteTarget | null {
  const attach = chatDropAt(element);
  if (attach) return { kind: "chat", attach };
  const host = element.closest<HTMLElement>(".cm-editor");
  const view = host ? EditorView.findFromDOM(host) : null;
  return view ? { kind: "editor", view, at: view.state.selection.main.head } : null;
}

/** What the paste event carried, read while the event was live. */
interface Pasted {
  bytes: readonly File[];
  text: string;
}

/** Take a file paste; resolves whether the pasteboard still holds file refs. */
async function pasteFiles(route: PasteFiles, target: PasteTarget, pasted: Pasted): Promise<boolean> {
  const paths = route.paths ? await clipboardFilePaths() : [];
  if (paths.length > 0) {
    await deliverFiles(paths, target);
    return true;
  }
  if (route.bytes && target.kind === "editor" && pasted.bytes.length > 0) {
    const rootId = rootIdOf(target.view.state.facet(noteIdFacet));
    await importImageFilesAtPosition(target.view, pasted.bytes, target.at, (name, base64) =>
      corpusCreateImageAsset(rootId, name, base64),
    );
    await invalidateNotes();
    return route.paths;
  }
  const stillHasFiles = await clipboardHasFiles().catch(() => false);
  const outcome = emptyPasteOutcome(stillHasFiles, target.kind, pasted.text);
  if (outcome === "insert-text" && target.kind === "editor") {
    const { view, at } = target;
    view.dispatch({
      changes: { from: at, insert: pasted.text },
      selection: { anchor: at + pasted.text.length },
    });
  } else if (outcome === "paste-again") {
    showFileNotice("The clipboard changed — paste again");
  } else {
    showFileNotice(COPY_AGAIN);
  }
  return stillHasFiles;
}

export function useNativeFilePaste(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let pasteboardHasFiles = false;
    const refresh = () => {
      void clipboardHasFiles()
        .then((has) => {
          pasteboardHasFiles = has;
        })
        .catch(() => {
          pasteboardHasFiles = false;
        });
    };
    // a copy or cut inside Rotli replaces whatever Finder put there
    const forget = () => {
      pasteboardHasFiles = false;
    };
    const onPaste = (event: ClipboardEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      const data = event.clipboardData;
      if (!element || !data) return;
      // the caret is read now, before any await can move it
      const target = pasteTarget(element);
      if (!target) return;
      const payload = {
        types: [...data.types],
        fileCount: data.files.length,
        uriList: data.getData("text/uri-list"),
      };
      const route = classifyPaste(payload, target.kind, pasteboardHasFiles);
      if (!route) return;
      event.preventDefault();
      event.stopPropagation();
      // File objects and clipboard text are only readable during the event
      const pasted = {
        bytes: [...data.files].filter((file) => isImagePath(file.name)),
        text: data.getData("text/plain"),
      };
      void pasteFiles(route, target, pasted)
        .then((hasFiles) => {
          // a stale focus-time signal must not catch the next paste as well
          pasteboardHasFiles = hasFiles;
        })
        .catch((error: unknown) => {
          showFileNotice(
            `Couldn’t paste the copied file — ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("copy", forget, true);
    document.addEventListener("cut", forget, true);
    window.addEventListener("paste", onPaste, true);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("copy", forget, true);
      document.removeEventListener("cut", forget, true);
      window.removeEventListener("paste", onPaste, true);
    };
  }, []);
}
