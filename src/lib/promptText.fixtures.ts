// Test-only constructors for the prompt brands; check:prompt-brands lets only
// *.test.* files (and the eval scripts under scripts/, which drive fake
// hosts) import this.
import type { Host } from "../ai/types";
import type { Approved, ApprovedText, ModelText, PersonText, PromptPart, PromptText } from "./promptText";

export const approved = (text: string): ApprovedText => text as ApprovedText;
export const promptOf = (text: string): PromptText => text as PromptText;
export const person = (text: string): PersonText => text as PersonText;
export const model = (text: string): ModelText => text as ModelText;
export const approvedRow = <T>(row: T): Approved<T> => row as unknown as Approved<T>;
export const approvedRows = <T>(rows: readonly T[]): Approved<T>[] => rows.map(approvedRow);

/** A value with every brand taken off: what a scripted fake writes. */
export type Unbrand<T> = T extends PromptPart
  ? string
  : T extends readonly (infer E)[]
    ? Unbrand<E>[]
    : T extends object
      ? { [K in keyof T]: Unbrand<T[K]> }
      : T;
type LooseMethod<F> = F extends (...args: infer A) => Promise<infer R>
  ? (...args: A) => Promise<Unbrand<R>>
  : F;
/** A Host whose methods answer plain strings (a scripted fake). */
export type LooseHost = { [K in keyof Host]: LooseMethod<Host[K]> };

/** A scripted fake host, its answers taken as the brands the real host gives. */
export const brandHost = (host: LooseHost): Host => host as unknown as Host;
