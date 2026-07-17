/**
 * Session policy for newly-created managed documents.
 *
 * A document starts as pristine, stops being disposable after its first real
 * content mutation, and is claimed for cleanup only after its final tab closes.
 * The registry is deliberately in-memory: an app restart must never infer that
 * an existing blank document is safe to delete.
 */
export class PristineDocumentDrafts {
  private readonly ids = new Set<string>();

  track(fileId: string): void {
    if (fileId) this.ids.add(fileId);
  }

  markChanged(fileId: string): void {
    this.ids.delete(fileId);
  }

  /**
   * Claim closed pristine documents exactly once. A duplicate tab keeps the
   * document alive until the last view closes.
   */
  claimClosed(fileIds: Iterable<string>, stillOpenFileIds: Iterable<string>): string[] {
    const stillOpen = new Set(stillOpenFileIds);
    const claimed: string[] = [];
    for (const fileId of new Set(fileIds)) {
      if (!stillOpen.has(fileId) && this.ids.delete(fileId)) claimed.push(fileId);
    }
    return claimed;
  }

  has(fileId: string): boolean {
    return this.ids.has(fileId);
  }
}
