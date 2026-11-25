// Where personal theme files live: the Mac app's themes folder, or memory in
// a browser build.

export interface ThemeFileStore {
  /** The ids there are, sorted. */
  list(): Promise<string[]>;
  /** A theme file's text, or null when it isn't there. */
  read(id: string): Promise<string | null>;
  write(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
}
