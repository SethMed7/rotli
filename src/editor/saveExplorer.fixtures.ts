// The save-state explorer's world (seventh review of pull request 267: stop
// finding save bugs by reading; build a test that finds them). The real
// model.ts and saveQueue.ts drive one or two notes on the fake disk that
// follows Rust's write contract (writeLane.fixtures.ts). Every read, write,
// create and file-change notice is held until a move releases it, fails it,
// lands it and then fails it, or leaves it never settling; the clock moves
// only when a move advances it. A schedule is a list of moves; the same list
// always runs the same way.
//
// The invariants, checked after every move and at the end of every schedule:
// I1 Once the process exits (quit's two phases, src-tauri/src/quit_flush.rs,
//    each window's answer a move of its own: main flushes, another window
//    answers its flush, then each answers the immediate question, and moves
//    go on between them until the last answer), whatever lands afterwards (any
//    subset of the writes and creates already handed to the disk, in any
//    order), each note's file holds the words the person had in it when main
//    answered the immediate question, or those words are in a recovery note
//    the person was shown (the conflict-copy notice names it), or they chose
//    Discard for them. Words typed after main's answer and before the last
//    answer are the residual the design accepts (bounded by the question's
//    bound in Rust); the run counts them.
// I2 A note reads saved (not dirty) only when its file equals the buffer and
//    no write for it is unresolved (an unresolved write counts as able to
//    change the file).
// I3 Words the person typed are never absent from both the buffer and the disk
//    (the note's file or a recovery note), unless they chose Discard. Words are
//    owed until newer typing replaces them, or until another app changes or
//    deletes the file while those words are on it (then that app replaced
//    them, not Rotli). One case more is forgiven, the one a three-way merge is
//    designed for: when the buffer takes in a version another app wrote (an
//    accepted read, never one that was dropped) and the person's text equals
//    what Rotli had last saved (its baseline, or a write of its own answered
//    since the last look), the person changed nothing, and the merge took the
//    other app's text. Nothing else is remembered or forgiven. A recovery
//    note counts only while the notice naming it is shown.
// I4 Once every acknowledgement has settled and every timer has run, no note's
//    queue is busy, and quit succeeds. Exempt, on purpose, note by note against
//    quit's actual reasons: a note whose write or create never settles, while
//    it says so by name, stays unsaved and quit names it (Rotli can't know
//    whether that write will land); and a deleted note with unsaved words,
//    until the person copies or discards them.
// I5 A recovery or conflict copy is made at most once per event (each copy
//    is counted against the outside change or deletion that led to it), and
//    carries its source's protection and lock, whatever lands after a process
//    death.

import { setReadHooksForTests } from "../services/noteReads";
import { queryClient } from "../services/query";
import type { Note } from "../types";
import { baselineOf, bufferText, hasBuffer } from "./buffers";
import { copiedAside } from "./copiedAside";
import { flushNoteAfterPaint } from "./flushAfterPaint";
import {
  adoptReadNote,
  discardGoneNote,
  ensureDocument,
  evictDocument,
  onDocumentChange,
  setCreateNoteForTests,
  setDocumentText,
  setReadNoteForTests,
  setWriteNoteBodyForTests,
  stampRead,
} from "./model";
import { setClockForTests } from "./saveClock";
import { refetchInto, watchCache } from "./saveExplorerCache.fixtures";
import { copyWords, HandClock, titleOf } from "./saveExplorerClock.fixtures";
import { checkWorld, finishWorld, quitStart } from "./saveExplorerRules.fixtures";
import { goneNotes, resetSaveQueueForTests } from "./saveQueue";
import { type FakeLane, fakeLane } from "./writeLane.fixtures";

export interface NoteSpec {
  name: string;
  secure?: boolean;
  locked?: boolean;
}
export type MoveKind =
  | "type"
  | "undo"
  | "switch"
  | "close"
  | "outside"
  | "quiet"
  | "purge"
  | "restore"
  | "refetch"
  | "discard"
  | "quit"
  | "release"
  | "fail"
  | "landFail"
  | "land"
  | "never"
  | "advance";
export interface Scenario {
  name: string;
  notes: NoteSpec[];
  moves: MoveKind[];
  /** Per note: how many times each person move may happen in one schedule. */
  caps?: Partial<
    Record<
      "type" | "undo" | "outside" | "quiet" | "purge" | "restore" | "refetch" | "switch" | "close",
      number
    >
  >;
  /** At most this many acknowledgements may be failed or left never settling. */
  faults?: number;
  /** Invariants to leave unchecked (to see what a schedule does past the first one it breaks). */
  ignore?: string[];
}

/** "answer": a query's read reaching the cache; "effect": the editor taking
 * what the cache holds for its note (editorSurface.tsx), a step of its own. */
export type AckKind = "write" | "read" | "create" | "notice" | "answer" | "effect" | "flush" | "question";
export interface Ack {
  serial: number;
  kind: AckKind;
  label: string;
  noteId: string | null;
  /** A write's words. */
  body?: string;
  /** A create's event: the note and the outside change or deletion that led to it. */
  event?: string;
  state: "held" | "settled" | "never";
  /** A write that reached the disk while its answer is still on its way. */
  landed?: { value?: unknown; error?: Error };
  apply(lane: FakeLane): unknown;
  resolve(value: unknown): void;
  reject(error: Error): void;
}
export interface Move {
  label: string;
  run(): unknown;
}
export interface Tracked {
  spec: NoteSpec;
  id: string;
  base: string;
  open: boolean;
  unsubscribe: () => void;
  used: Record<string, number>;
  events: number;
  /** The last words the person had in the note, and whether Rotli owes them. */
  words: string;
  owed: boolean;
  discarded: boolean;
  ids: string[];
  /** The buffer and what Rotli had last saved, as of the last look; and the
   * words Rotli's writes landed with since then. */
  seenText: string;
  seenBaseline: string | undefined;
  savedSince: Set<string>;
  /** Another app changed the file while the watcher was quiet, and no read
   * has been taken since: Rotli has no way to know yet. */
  unseen: boolean;
}

/** One quit attempt, window by window (quit_flush.rs). */
export interface Attempt {
  mainFlushed?: boolean;
  otherFlushed?: boolean;
  mainAnswered?: boolean;
  otherAnswered?: boolean;
  refused?: string;
  atAnswer?: Map<Tracked, { words: string; owed: boolean; discarded: boolean; later: Set<string> }>;
  onRefused?: (message: string) => void;
}

let worlds = 0;
export const drain = async () => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
export const MUTATIONS: AckKind[] = ["write", "create"];
export class World {
  readonly lane: FakeLane;
  readonly clock = new HandClock();
  readonly acks: Ack[] = [];
  readonly notes: Tracked[] = [];
  readonly trace: string[] = [];
  quit: "idle" | "flushing" | "checking" | "exited" = "idle";
  attempt: Attempt | null = null;
  /** Words typed after main's immediate answer and before the exit (the accepted residual). */
  residual = 0;
  /** Versions another app wrote. */
  readonly outside = new Set<string>();
  /** The copies the person had been shown when the process exited. */
  shownAtQuit = new Set<string>();
  /** Which event each copy (by id) was made for. */
  readonly copyEvents = new Map<string, string>();
  faults = 0;
  /** Each recovery event id's label (note#changes) when it was first asked. */
  private readonly eventLabels = new Map<string, string>();
  private readonly stopWatchingCache: () => void;
  readonly prefix: string;

  constructor(readonly scenario: Scenario) {
    worlds += 1;
    this.prefix = `w${worlds}`;
    this.lane = fakeLane(this.prefix);
    setClockForTests(this.clock);
    resetSaveQueueForTests();
    setWriteNoteBodyForTests((id, body, revision, base) =>
      this.hold(
        "write",
        id,
        `“${body.split("\n")[2] ?? ""}”`,
        (lane) => lane.write(id, body, revision, base),
        body,
      ),
    );
    setReadNoteForTests((id) =>
      this.hold("read", id, "", (lane) => {
        const note = this.notes.find((each) => each.id === id);
        if (note) note.unseen = false;
        return lane.read(id);
      }),
    );
    setCreateNoteForTests((folder, body, protection, event) => {
      const source = this.notes.find((note) => note.spec.name === titleOf(body));
      // a retry carries its first ask's event id: label it as that ask was,
      // not by the changes counted since (tenth review's round, a full walk)
      const made =
        (event && this.eventLabels.get(event)) || `${source?.spec.name ?? "?"}#${source?.events ?? 0}`;
      if (event) this.eventLabels.set(event, made);
      return this.hold(
        "create",
        null,
        `${titleOf(body)} “${body.split("\n")[2] ?? ""}”`,
        (lane) => lane.create(folder, body, { ...protection, ...(event ? { event } : {}) }),
        undefined,
        made,
      );
    });
    // a publish cancels the note's reads on their way and reads again (noteReads.ts)
    setReadHooksForTests({
      cancel: (noteId) => {
        let any = false;
        for (const ack of this.acks)
          if (ack.kind === "answer" && ack.noteId === noteId && ack.state === "held") {
            ack.state = "settled";
            ack.reject(new Error("cancelled"));
            any = true;
          }
        return any;
      },
      refresh: (noteId) => {
        const note = this.notes.find((each) => each.id === noteId);
        if (note && this.lane.files.has(noteId)) this.refetch(note);
      },
    });
    this.stopWatchingCache = watchCache(this);
    for (const spec of scenario.notes) {
      const base = `# ${spec.name}\n\nbase`;
      const made = this.lane.create("Inbox", base, spec);
      ensureDocument(made.id, made.body, made.revision, made);
      const unsubscribe = onDocumentChange(made.id, () => {});
      this.notes.push({
        spec,
        id: made.id,
        base,
        open: true,
        unsubscribe,
        used: {},
        events: 0,
        words: base,
        owed: false,
        discarded: false,
        ids: [made.id],
        seenText: base,
        seenBaseline: base,
        savedSince: new Set(),
        unseen: false,
      });
    }
  }

  nameOf(noteId: string | null): string {
    return this.notes.find((note) => note.id === noteId)?.spec.name ?? "";
  }

  /** Whether each note's words are still owed (for tests of the oracle itself). */
  owedNow(): Record<string, boolean> {
    return Object.fromEntries(this.notes.map((note) => [note.spec.name, this.owes(note)]));
  }

  owes(note: Tracked): boolean {
    return note.owed && !note.discarded;
  }

  /** Read through methods: a callback may have changed it since TypeScript last looked. */
  acked(): boolean {
    return this.quit === "exited";
  }
  waiting(): boolean {
    return this.quit === "flushing" || this.quit === "checking";
  }

  on(invariant: string): boolean {
    return !this.scenario.ignore?.includes(invariant);
  }

  hold<T>(
    kind: AckKind,
    noteId: string | null,
    what: string,
    apply: (lane: FakeLane) => unknown,
    body?: string,
    event?: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const serial = this.acks.length + 1;
      const label = `${kind}#${serial} ${this.nameOf(noteId)}${what ? ` ${what}` : ""}`
        .replace(/ +/g, " ")
        .trim();
      this.acks.push({
        serial,
        kind,
        label,
        noteId,
        ...(body === undefined ? {} : { body }),
        ...(event === undefined ? {} : { event }),
        state: "held",
        apply,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
  }

  /** The moves the person and the scheduler can make now, in a fixed order. */
  moves(): Move[] {
    if (this.quit === "exited") return [];
    const allowed = new Set(this.scenario.moves);
    const caps = this.scenario.caps ?? {};
    const out: Move[] = [];
    const may = (note: Tracked, kind: keyof NonNullable<Scenario["caps"]>) =>
      allowed.has(kind) && (note.used[kind] ?? 0) < (caps[kind] ?? 1);
    const spend = (note: Tracked, kind: string) => (note.used[kind] = (note.used[kind] ?? 0) + 1);
    for (const note of this.notes) {
      const { id, spec } = note;
      const live = hasBuffer(id) && note.open;
      const onDisk = this.lane.files.has(id);
      if (live && may(note, "type"))
        out.push({
          label: `type ${spec.name}`,
          run: () => {
            spend(note, "type");
            this.typed(note, `# ${spec.name}\n\nv${note.used.type}`);
          },
        });
      if (live && may(note, "undo") && bufferText(id) !== note.base)
        out.push({
          label: `undo ${spec.name}`,
          run: () => (spend(note, "undo"), this.typed(note, note.base)),
        });
      if (live && may(note, "switch"))
        out.push({ label: `switch ${spec.name}`, run: () => (spend(note, "switch"), this.afterPaint(id)) });
      if (live && may(note, "close"))
        out.push({
          label: `close ${spec.name}`,
          run: () => {
            spend(note, "close");
            note.open = false;
            note.unsubscribe();
            this.afterPaint(id);
          },
        });
      if (onDisk && may(note, "outside"))
        out.push({
          label: `outside ${spec.name}`,
          run: () => {
            spend(note, "outside");
            this.byAnotherApp(note);
            const body = `# ${spec.name}\n\nout${note.used.outside}`;
            this.outside.add(body);
            this.lane.external(id, body);
            void this.hold("notice", id, "", (lane) => {
              const file = lane.read(id);
              if (file) adoptReadNote(stampRead(file));
            });
          },
        });
      if (onDisk && may(note, "quiet"))
        out.push({
          // the watcher is still quiet after Rotli's own write: no notice comes
          label: `outside ${spec.name} unnoticed`,
          run: () => {
            spend(note, "quiet");
            note.unseen = true;
            this.byAnotherApp(note);
            const body = `# ${spec.name}\n\nquiet${note.used.quiet}`;
            this.outside.add(body);
            this.lane.external(id, body);
          },
        });
      if (onDisk && may(note, "purge"))
        out.push({
          label: `purge ${spec.name}`,
          run: () => {
            spend(note, "purge");
            this.byAnotherApp(note);
            this.lane.purge(id);
          },
        });
      if (!onDisk && this.lane.purged.has(id) && may(note, "restore"))
        out.push({
          label: `restore ${spec.name}`,
          run: () => {
            spend(note, "restore");
            this.lane.restore(id);
            this.outside.add(this.lane.read(id)!.body);
            void this.hold("notice", id, "", (lane) => {
              const file = lane.read(id);
              if (file) adoptReadNote(stampRead(file));
            });
          },
        });
      if (onDisk && may(note, "refetch"))
        out.push({
          label: `refetch ${spec.name}`,
          run: () => {
            spend(note, "refetch");
            this.refetch(note);
          },
        });
      const gone = goneNotes().includes(id);
      if (gone && allowed.has("discard"))
        out.push({
          label: `discard ${spec.name}`,
          run: () => {
            discardGoneNote(id);
            if (goneNotes().includes(id)) return;
            note.discarded = true;
            note.owed = false;
          },
        });
    }
    if (allowed.has("quit") && this.quit === "idle")
      out.push({
        label: "quit",
        run: () => this.startQuit(),
      });
    const faultsLeft = (this.scenario.faults ?? 1) > this.faults;
    for (const ack of this.acks) {
      if (ack.state !== "held") continue;
      if (allowed.has("release"))
        out.push({ label: `release ${ack.label}`, run: () => this.settle(ack, "release") });
      if (ack.kind === "notice" || ack.kind === "answer" || ack.kind === "effect" || !faultsLeft) continue;
      if (allowed.has("fail")) out.push({ label: `fail ${ack.label}`, run: () => this.settle(ack, "fail") });
      if (allowed.has("land") && ack.kind === "write" && !ack.landed)
        out.push({ label: `land ${ack.label} (its answer waits)`, run: () => this.settle(ack, "land") });
      if (ack.landed) continue;
      if (allowed.has("landFail") && MUTATIONS.includes(ack.kind))
        out.push({ label: `land-then-fail ${ack.label}`, run: () => this.settle(ack, "landFail") });
      if (allowed.has("never") && ack.kind !== "flush" && ack.kind !== "question")
        out.push({ label: `never ${ack.label}`, run: () => this.settle(ack, "never") });
    }
    if (allowed.has("advance") && this.clock.timers.size > 0)
      out.push({ label: "advance", run: () => this.trace.push(`  (+${this.clock.fire()} ms)`) });
    return out;
  }

  /** A query reads the file now (saveExplorerCache.fixtures.ts). */
  refetch(note: Tracked): void {
    refetchInto(this, note);
  }

  startQuit(onRefused?: (message: string) => void): void {
    quitStart(this, onRefused);
  }

  typed(note: Tracked, text: string): void {
    this.attempt?.atAnswer?.get(note)?.later.add(text);
    setDocumentText(note.id, text);
    note.seenText = bufferText(note.id) ?? note.seenText;
    note.words = text;
    note.owed = true;
  }

  /** Another app changes or deletes the file: words it overwrites on disk were saved. */
  byAnotherApp(note: Tracked): void {
    note.events += 1;
    const before = this.lane.read(note.id)?.body;
    if (before === note.words) note.owed = false;
    const then = this.attempt?.atAnswer?.get(note);
    if (then && (before === then.words || then.later.has(before ?? ""))) then.owed = false;
  }

  /** Look at every buffer: one that changed without typing took a version
   * from disk. If that version is another app's and the person's text equals
   * what Rotli had last saved, the person changed nothing, and the merge took
   * the other app's text (the case I3 forgives). */
  observe(): void {
    for (const note of this.notes) {
      const text = bufferText(note.id);
      if (text !== undefined && text !== note.seenText) {
        const saved = note.words === note.seenBaseline || note.savedSince.has(note.words);
        if (this.outside.has(text) && saved) note.owed = false;
        note.seenText = text;
      }
      note.seenBaseline = baselineOf(note.id) ?? note.seenBaseline;
      note.savedSince.clear();
    }
  }

  /** The note a write's answer belongs to. */
  savedOf(ack: Ack): Tracked | undefined {
    return this.notes.find((note) => note.id === ack.noteId);
  }

  /** The recovery notes the person is being shown (the conflict-copy notice). */
  shown(): Set<string> {
    return new Set(copiedAside().map((aside) => aside.copyId));
  }

  afterPaint(noteId: string): void {
    flushNoteAfterPaint(noteId, (task) => void this.clock.setTimeout(task, 0));
  }

  settle(ack: Ack, how: "release" | "fail" | "landFail" | "land" | "never"): void {
    if (how === "land") {
      // the write reaches the disk now; its answer comes when it is released
      try {
        ack.landed = { value: ack.apply(this.lane) };
      } catch (error) {
        ack.landed = { error: error as Error };
      }
      if (ack.landed.value && ack.event) this.copyEvents.set((ack.landed.value as Note).id, ack.event);
      return;
    }
    if (ack.landed) {
      // it is on disk already: its answer comes, is lost, or never comes
      if (how === "never") {
        this.faults += 1;
        ack.state = "never";
        return;
      }
      ack.state = "settled";
      if (how !== "release") {
        this.faults += 1;
        return ack.reject(new Error("it was written, but the answer was lost"));
      }
      if (!ack.landed.error && ack.body !== undefined) this.savedOf(ack)?.savedSince.add(ack.body);
      return ack.landed.error ? ack.reject(ack.landed.error) : ack.resolve(ack.landed.value);
    }
    if (how !== "release") this.faults += 1;
    if (how === "never") {
      ack.state = "never";
      return;
    }
    ack.state = "settled";
    if (how === "fail") return ack.reject(new Error(ack.kind === "read" ? "read failed" : "disk full"));
    let value: unknown;
    try {
      value = ack.apply(this.lane);
    } catch (error) {
      return ack.reject(error as Error);
    }
    if (ack.event && value) this.copyEvents.set((value as Note).id, ack.event);
    if (how === "landFail") return ack.reject(new Error("it was written, but the answer was lost"));
    if (ack.kind === "write" && ack.body !== undefined) this.savedOf(ack)?.savedSince.add(ack.body);
    ack.resolve(value);
  }

  /** Files that aren't one of the world's notes: recovery and conflict copies. */
  copies(lane: FakeLane) {
    const ids = new Set(this.notes.flatMap((note) => note.ids));
    return [...lane.files.entries()]
      .filter(([id]) => !ids.has(id))
      .map(([id, file]) => ({ ...file, id, source: titleOf(file.body), words: copyWords(file.body) }));
  }

  /** The invariants that hold at every step (saveExplorerRules.fixtures.ts). */
  check(): string | null {
    return checkWorld(this);
  }

  /** The end of a schedule (saveExplorerRules.fixtures.ts). */
  finish(): Promise<string | null> {
    return finishWorld(this);
  }

  dispose(): void {
    this.stopWatchingCache();
    setReadHooksForTests(null);
    for (const note of this.notes) if (note.open) note.unsubscribe();
    for (const id of [...this.lane.files.keys(), ...this.notes.flatMap((note) => note.ids)])
      if (hasBuffer(id)) evictDocument(id);
    resetSaveQueueForTests();
    setWriteNoteBodyForTests(null);
    setReadNoteForTests(null);
    setCreateNoteForTests(null);
    setClockForTests(null);
    queryClient.clear();
  }
}
