import type { AiBodyEdit } from "./aiEditPolicy";

/** Metadata returned by the Rust corpus for the note panel and AI gates. */
export interface FrontmatterView {
  id: string;
  created: string;
  updated: string;
  locked: boolean;
  /** Secrets detected (auto-flagged) → never sent to a remote model + gitignored. */
  secure: boolean;
  /** Effective loopback-local AI permission: note override → vault setting → on. */
  localAiAllowed: boolean;
  pinned: boolean;
  aiBodyEdit: AiBodyEdit;
  fields: string[];
}
