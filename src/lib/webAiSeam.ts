// Rotli Web's two registrations into the IPC seam: the bridge that carries
// the AI commands to Rotli Helper once paired, and the model-facing view of
// the browser-side vault. Both are set at boot by services/ and read by
// lib/tauri.ts; the desktop build never sets either.

/** The AI commands ride Rotli Helper on the user's computer once the page is
 * paired (services/helperLink registers the bridge). Unpaired, they are
 * refused as before. */
export type WebAiBridge = (cmd: string, args: Record<string, unknown> | undefined) => Promise<unknown>;
let webAiBridge: WebAiBridge | null = null;
export function registerWebAiBridge(bridge: WebAiBridge | null): void {
  webAiBridge = bridge;
}
export function currentWebAiBridge(): WebAiBridge | null {
  return webAiBridge;
}

/** The model-facing view of the browser-side vault, with the secure-note law
 * applied by services/webAiCorpus (Rust's job in the app). The wire shapes
 * are lib/tauri's; this seam stays shape-agnostic so it never imports it. */
export interface WebAiCorpusShape<Meta, Hit, Read, Frontmatter> {
  list(): Promise<Meta[]>;
  search(query: string, limit: number | undefined): Promise<Hit[]>;
  read(id: string): Promise<Read>;
  readableIds(ids: string[]): Promise<string[]>;
  frontmatter(id: string): Promise<Frontmatter | null>;
}
type AnyWebAiCorpus = WebAiCorpusShape<unknown, unknown, unknown, unknown>;
let webAiCorpus: AnyWebAiCorpus | null = null;
export function registerWebAiCorpus(corpus: AnyWebAiCorpus | null): void {
  webAiCorpus = corpus;
}
export function currentWebAiCorpus<T extends AnyWebAiCorpus>(): T | null {
  return webAiCorpus as T | null;
}

/** The memex commands (chats and their folders) answered by the web's own
 * chat store once registered (services/webChats); unregistered, refused. */
export type WebMemexBridge = (cmd: string, args: Record<string, unknown> | undefined) => Promise<unknown>;
let webMemexBridge: WebMemexBridge | null = null;
export function registerWebMemexBridge(bridge: WebMemexBridge | null): void {
  webMemexBridge = bridge;
}
export function currentWebMemexBridge(): WebMemexBridge | null {
  return webMemexBridge;
}

/** Rotli Web's file lane: dropped images stored beside the notes and served
 * back as displayable URLs (services/webFiles). The desktop never sets it. */
export interface WebFileStoreShape {
  createImageAsset(rootId: string, name: string, base64: string): Promise<string>;
  imageUrl(rel: string): Promise<string>;
}
let webFileStore: WebFileStoreShape | null = null;
export function registerWebFileStore(store: WebFileStoreShape | null): void {
  webFileStore = store;
}
export function currentWebFileStore(): WebFileStoreShape | null {
  return webFileStore;
}
