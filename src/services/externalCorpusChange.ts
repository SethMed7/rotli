export interface ExternalCorpusRefreshers {
  folders: () => void | Promise<void>;
  notes: () => void | Promise<void>;
  chats: () => void | Promise<void>;
  chatFolders: () => void | Promise<void>;
  main: () => void | Promise<void>;
  views: () => void | Promise<void>;
  journal: () => void | Promise<void>;
}

/** A filesystem event invalidates every projection that can be changed by a
 * second Rotli process, CLI/MCP, or an external editor. Settle independently:
 * one malformed rebuildable sidecar must not leave the durable chat/note lists
 * stale in this window. */
export async function refreshAfterExternalCorpusChange(refreshers: ExternalCorpusRefreshers): Promise<void> {
  // Defer invocation as well as awaiting it: a refresher may fail
  // synchronously before returning a Promise, and that must not prevent the
  // remaining canonical projections from being refreshed.
  const run = (refresh: () => void | Promise<void>) => Promise.resolve().then(refresh);
  await Promise.allSettled([
    run(refreshers.folders),
    run(refreshers.notes),
    run(refreshers.chats),
    run(refreshers.chatFolders),
    run(refreshers.main),
    run(refreshers.views),
    run(refreshers.journal),
  ]);
}
