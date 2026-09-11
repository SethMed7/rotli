export interface VaultBrowserEntry {
  name: string;
}

export interface VaultBrowserView {
  absolutePath: string;
  displayPath: string;
  homePath: string;
  directories: VaultBrowserEntry[];
  canGoBack: boolean;
  canSelect: boolean;
  selectDisabledReason: string | null;
}

export const browserEmptyFolders = new Set<string>();
export const browserVaultHome: VaultBrowserView = {
  absolutePath: "/Users/example",
  displayPath: "~",
  homePath: "/Users/example",
  directories: ["Applications", "Desktop", "Documents", "Downloads", "Library"].map((name) => ({ name })),
  canGoBack: false,
  canSelect: false,
  selectDisabledReason:
    "Choose or create a folder inside Home. Home itself includes private app and credential data.",
};
export const browserVaultPreview = { view: browserVaultHome };
