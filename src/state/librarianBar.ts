// Which pane's editor shows the Librarian bar in place of its format bar
// (/librarian, 2026-09-28). Session state only.

import { create } from "zustand";

export const useLibrarianBar = create<{ paneId: string | null }>(() => ({ paneId: null }));

export function openLibrarianBar(paneId: string): void {
  useLibrarianBar.setState({ paneId });
}

export function closeLibrarianBar(): void {
  useLibrarianBar.setState({ paneId: null });
}
