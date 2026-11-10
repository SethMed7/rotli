// What may go into a model request, as types the compiler checks (third review
// of pull request 267, 2026-11-09). Three rounds of review each found another path by
// which a note's text reached a model without going through the approved read;
// fixing paths one by one wasn't converging. So the send boundary
// (lib/tauri.ts chatMessages, chatMessagesStream, cliComplete; ai/types.ts
// CompleteReq) accepts only `PromptText`, and `PromptText` is built only from:
//
// - text written in this source code: the `prompt` tag's literal parts;
// - `ApprovedText`: note-derived text (titles, bodies, snippets, folders,
//   aliases, People names, memory) that came out of the gated, versioned read
//   for the model in use. Its only constructor is private to
//   ai/approvedRead.ts, the module that performs those reads;
// - `PersonText`: what the person typed;
// - `ModelText`: what a model wrote (replies, its own earlier turns);
// - `ExternalText`: what isn't a note: web pages, Rotli's own status lines.
//
// The constructors below are importable only by the modules check:architecture
// names, and a cast to any of these types outside this file (or, for
// ApprovedText, outside ai/approvedRead.ts) fails the same check. The brands
// are types only: nothing here changes a string at runtime.

declare const promptBrand: unique symbol;
declare const approvedBrand: unique symbol;
declare const personBrand: unique symbol;
declare const modelBrand: unique symbol;
declare const externalBrand: unique symbol;

/** Text a model request may carry. Built only by `prompt`, `joinPrompt`, `promptJson`. */
export type PromptText = string & { readonly [promptBrand]: true };
/** Note-derived text from the gated read for the model in use (ai/approvedRead.ts). */
export type ApprovedText = string & { readonly [approvedBrand]: true };
/** What the person typed. */
export type PersonText = string & { readonly [personBrand]: true };
/** What a model wrote. */
export type ModelText = string & { readonly [modelBrand]: true };
/** Text that is neither a note nor the person's: web content, Rotli's own words. */
export type ExternalText = string & { readonly [externalBrand]: true };

/** One piece of a prompt. A plain `string` is not one. */
export type PromptPart = PromptText | ApprovedText | PersonText | ModelText | ExternalText;

/** One field of a row, approved: a string read from the note becomes
 * ApprovedText; a literal union (a row's `kind`) and non-strings stay as
 * they are. */
type ApprovedField<V> = V extends string
  ? string extends V
    ? ApprovedText
    : V
  : V extends readonly string[]
    ? readonly ApprovedText[]
    : V;

/** A row's every string field, approved (made only in ai/approvedRead.ts). */
export type Approved<T> = { readonly [K in keyof T]: ApprovedField<T[K]> };

/** A piece the compiler accepts: a prompt part, a number or flag, or a string
 * whose type is a literal written in this source code. A widened `string`
 * (anything read at runtime: a note, a cache, the UI index) is `never`. */
type Piece<T> = T extends PromptPart | number | boolean | null | undefined
  ? T
  : T extends string
    ? string extends T
      ? never
      : T
    : never;

/** A JSON value whose every string is a `Piece` (for tool observations). */
type Checked<V> = V extends string | number | boolean | null | undefined
  ? Piece<V>
  : V extends readonly (infer E)[]
    ? readonly Checked<E>[]
    : V extends object
      ? { readonly [K in keyof V]: Checked<V[K]> }
      : never;

/** A prompt from source text and typed pieces: prompt`Note:\n${approvedBody}`. */
export function prompt<const P extends readonly unknown[]>(
  strings: TemplateStringsArray,
  ...parts: P & { readonly [K in keyof P]: Piece<P[K]> }
): PromptText {
  let out = strings[0] ?? "";
  (parts as readonly unknown[]).forEach((part, index) => {
    out += String(part) + (strings[index + 1] ?? "");
  });
  return out as PromptText;
}

export const NO_TEXT = "" as PromptText;

/** One fixed line written in this source code (a literal-typed string only). */
export function fixed<const S extends string>(text: Piece<S>): PromptText {
  return text as unknown as PromptText;
}

export function joinPrompt<const S extends string = "">(
  parts: readonly PromptPart[],
  separator?: Piece<S>,
): PromptText {
  return parts.join(separator ?? "") as PromptText;
}

/** JSON of a value whose every string is a `Piece`. */
export function promptJson<const V>(value: V & Checked<V>): PromptText {
  return JSON.stringify(value) as PromptText;
}

/** A piece kept as what it is, with the same text reshaped by `change`: a
 * truncation, a trim, a defusing pass. `change` must only transform the text
 * it is given (importers are named in check:architecture). */
export function reshape<T extends PromptPart>(text: T, change: (text: string) => string): T {
  return change(text) as T;
}

/** `reshape` for an asynchronous change (a workbook rendered from its bytes). */
export async function reshapeAsync<T extends PromptPart>(
  text: T,
  change: (text: string) => Promise<string>,
): Promise<T> {
  return (await change(text)) as T;
}

/** What the person typed (composer input, the Librarian's box, an /ai ask). */
export function personText(text: string): PersonText {
  return text as PersonText;
}

/** What a model wrote: its replies, its own earlier turns. */
export function modelText(text: string): ModelText {
  return text as ModelText;
}

/** Text that isn't a note or the person's: a web page, Rotli's own status line. */
export function externalText(text: string): ExternalText {
  return text as ExternalText;
}
