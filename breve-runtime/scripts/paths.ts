/**
 * BREVE storage layout — Breve holds NO durable knowledge; it's logic over the memex.
 *   managed/briefs/   canonical Rotli brief library (.md/.html/.audio.txt/.suggestion.json)
 *                     pipeline (render + lunch/night + Signal Q&A) reads it; daily-log.ts distills the
 *                     day into the memex history/ and prunes this to ~2 days. NOT the record. (gitignored)
 *   memex history/    the DURABLE record (distilled daily digest) — the knowledge layer, not here.
 *   storage breveAudios/ brevePDFs/ breveViews/ breveTopics/ — mp3s, PDFs, PNG renders, topic deep-dives; the only copy (binaries)
 *   storage breveCaptures/ — images/PDFs you share over Signal, filed by topic
 * See docs/memex-boundary.md → "Breve holds no durable knowledge".
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { storagePath } from "./config";

/** Mutable Breve state lives in Rotli's managed runtime home. The source-tree
 * fallback keeps direct developer/test runs working. */
export const BREVE = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");
export const BRIEFS = join(BREVE, "briefs");

const STORE = storagePath();
export const AUDIOS = join(STORE, "breveAudios");
export const PDFS = join(STORE, "brevePDFs");
export const VIEWS = join(STORE, "breveViews");
export const TOPICS = join(STORE, "breveTopics"); // audio/HTML topic deep-dives — binaries, not the ephemeral cache
// The ONLY root Breve writes Signal-shared media into — one topic subfolder per capture
// (breveCaptures/<topic>/<date>-<id>.<ext>). Single allowlisted write path = clean security
// boundary; every destination is verified to resolve under here before any byte is written.
export const CAPTURES = join(STORE, "breveCaptures");

for (const d of [TOPICS, AUDIOS, PDFS, VIEWS, CAPTURES]) mkdirSync(d, { recursive: true });
