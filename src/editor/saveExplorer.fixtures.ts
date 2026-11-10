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
// I1 Once quit was acknowledged (the real acknowledgement: after every quit
//    flusher, including another window's that settles later, and with typing
//    legal until then), whatever lands afterwards (any subset of the writes and
//    creates already handed to the disk, in any order), each note's file holds
//    the last words the person had in it, or those words are in a recovery note
//    the person was shown (the conflict-copy notice names it), or they chose
//    Discard for them.
// I2 A note reads saved (not dirty) only when its file equals the buffer and
//    no write for it is unresolved (an unresolved write counts as able to
//    change the file).
// I3 Words the person typed are never absent from both the buffer and the disk
//    (the note's file or a recovery note), unless they chose Discard. Words are
//    owed until newer typing replaces them, or until another app changes or
//    deletes the file while those words are on it (then that app replaced
//    them, not Rotli). One case more is forgiven, the one a three-way merge is
//    designed for: when Rotli sees another app's change (a notice, a query's
//    answer, or its own read of the file) and the person's text equals what
//    Rotli last saved, the person changed nothing, and the merge takes the
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

import { onQuitFlush, runQuitTransaction } from "../lib/quitFlush";
import { queryClient } from "../services/query";
import type { Note } from "../types";
import { baselineOf, bufferText, hasBuffer } from "./buffers";
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
import { cloneLane, copyWords, HandClock, landings, titleOf } from "./saveExplorerClock.fixtures";
import { copiedAside, goneNotes, queueBusy, resetSaveQueueForTests } from "./saveQueue";
import { documentSaveError, isDirty } from "./saveStatus";
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
  | "purge"
  | "refetch"
  | "discard"
  | "quit"
  | "release"
  | "fail"
  | "landFail"
  | "never"
  | "advance";
export interface Scenario {
  name: string;
  notes: NoteSpec[];
  moves: MoveKind[];
  /** Per note: how many times each person move may happen in one schedule. */
  caps?: Partial<Record<"type" | "undo" | "outside" | "purge" | "refetch" | "switch" | "close", number>>;
  /** At most this many acknowledgements may be failed or left never settling. */
  faults?: number;
  /** Invariants to leave unchecked (to see what a schedule does past the first one it breaks). */
  ignore?: string[];
}

type AckKind = "write" | "read" | "create" | "notice" | "answer" | "flusher";
interface Ack {
  serial: number;
  kind: AckKind;
  label: string;
  noteId: string | null;
  /** A write's words. */
  body?: string;
  /** A create's event: the note and the outside change or deletion that led to it. */
  event?: string;
  state: "held" | "settled" | "never";
  apply(lane: FakeLane): unknown;
  resolve(value: unknown): void;
  reject(error: Error): void;
}
export interface Move {
  label: string;
  run(): unknown;
}
interface Tracked {
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
}

let worlds = 0;
export const drain = async () => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
const MUTATIONS: AckKind[] = ["write", "create"];
export class World {
  readonly lane: FakeLane;
  readonly clock = new HandClock();
  readonly acks: Ack[] = [];
  readonly notes: Tracked[] = [];
  readonly trace: string[] = [];
  quit: "idle" | "waiting" | "acked" = "idle";
  /** The copies the person had been shown when quit was acknowledged. */
  shownAtQuit = new Set<string>();
  /** Which event each copy (by id) was made for. */
  readonly copyEvents = new Map<string, string>();
  faults = 0;
  private readonly prefix: string;
  private readonly unregisterFlusher: () => void;

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
    setReadNoteForTests((id) => this.hold("read", id, "", (lane) => lane.read(id)));
    setCreateNoteForTests((folder, body, protection, event) => {
      const source = this.notes.find((note) => note.spec.name === titleOf(body));
      const made = `${source?.spec.name ?? "?"}#${source?.events ?? 0}`;
      return this.hold(
        "create",
        null,
        `${titleOf(body)} “${body.split("\n")[2] ?? ""}”`,
        (lane) => lane.create(folder, body, { ...protection, ...(event ? { event } : {}) }),
        undefined,
        made,
      );
    });
    // another window or a workbook, whose flush settles when the scheduler says
    this.unregisterFlusher = onQuitFlush(() => this.hold("flusher", null, "another window", () => undefined));
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
      });
    }
  }

  private nameOf(noteId: string | null): string {
    return this.notes.find((note) => note.id === noteId)?.spec.name ?? "";
  }

  private owes(note: Tracked): boolean {
    return note.owed && !note.discarded;
  }

  /** Read through methods: a callback may have changed it since TypeScript last looked. */
  acked(): boolean {
    return this.quit === "acked";
  }
  private waiting(): boolean {
    return this.quit === "waiting";
  }

  private on(invariant: string): boolean {
    return !this.scenario.ignore?.includes(invariant);
  }

  private hold<T>(
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
    if (this.quit === "acked") return [];
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
            this.lane.external(id, `# ${spec.name}\n\nout${note.used.outside}`);
            void this.hold("notice", id, "", (lane) => {
              const file = lane.read(id);
              if (file) this.sees(note, file.body);
              if (file) adoptReadNote(stampRead(file));
            });
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
      if (onDisk && may(note, "refetch"))
        out.push({
          label: `refetch ${spec.name}`,
          run: () => {
            spend(note, "refetch");
            // a query reads the file now; its answer reaches the editor later
            const snapshot = stampRead(this.lane.read(id)!);
            void this.hold("answer", id, `“${snapshot.body.split("\n")[2] ?? ""}”`, () => {
              this.sees(note, snapshot.body);
              adoptReadNote(snapshot);
            });
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
      if (ack.kind === "notice" || ack.kind === "answer" || !faultsLeft) continue;
      if (allowed.has("fail")) out.push({ label: `fail ${ack.label}`, run: () => this.settle(ack, "fail") });
      if (allowed.has("landFail") && MUTATIONS.includes(ack.kind))
        out.push({ label: `land-then-fail ${ack.label}`, run: () => this.settle(ack, "landFail") });
      if (allowed.has("never") && ack.kind !== "flusher")
        out.push({ label: `never ${ack.label}`, run: () => this.settle(ack, "never") });
    }
    if (allowed.has("advance") && this.clock.timers.size > 0)
      out.push({ label: "advance", run: () => this.trace.push(`  (+${this.clock.fire()} ms)`) });
    return out;
  }

  /** Ask to quit: acknowledged, quit is a leaf (the process ends); refused, the person may ask again. */
  private startQuit(refused?: (message: string) => void): void {
    this.quit = "waiting";
    runQuitTransaction().then(
      () => {
        this.quit = "acked";
        this.shownAtQuit = this.shown();
      },
      (error: Error) => {
        this.quit = "idle";
        this.trace.push(`  (quit refused: ${error.message})`);
        refused?.(error.message);
      },
    );
  }

  private typed(note: Tracked, text: string): void {
    setDocumentText(note.id, text);
    note.words = text;
    note.owed = true;
  }

  /** Another app changes or deletes the file: words it overwrites on disk were saved. */
  private byAnotherApp(note: Tracked): void {
    note.events += 1;
    if (this.lane.read(note.id)?.body === note.words) note.owed = false;
  }

  /** Rotli sees the file's `body`. If it is another version than Rotli last
   * saved, and the person's text equals what Rotli last saved, the person
   * changed nothing: the merge takes the other version (the case I3 forgives). */
  private sees(note: Tracked, body: string): void {
    const saved = baselineOf(note.id);
    if (body !== saved && note.words === saved) note.owed = false;
  }

  /** The recovery notes the person is being shown (the conflict-copy notice). */
  private shown(): Set<string> {
    return new Set(copiedAside().map((aside) => aside.copyId));
  }

  private afterPaint(noteId: string): void {
    flushNoteAfterPaint(noteId, (task) => void this.clock.setTimeout(task, 0));
  }

  private settle(ack: Ack, how: "release" | "fail" | "landFail" | "never"): void {
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
    const owner = this.notes.find((note) => note.id === ack.noteId);
    if (ack.kind === "read" && owner && value) this.sees(owner, (value as Note).body);
    if (how === "landFail") return ack.reject(new Error("it was written, but the answer was lost"));
    ack.resolve(value);
  }

  /** Files that aren't one of the world's notes: recovery and conflict copies. */
  copies(lane: FakeLane) {
    const ids = new Set(this.notes.flatMap((note) => note.ids));
    return [...lane.files.entries()]
      .filter(([id]) => !ids.has(id))
      .map(([id, file]) => ({ ...file, id, source: titleOf(file.body), words: copyWords(file.body) }));
  }

  /** The invariants that hold at every step (I2, I3, I5, and I1 once quit was acknowledged). */
  check(): string | null {
    for (const note of this.notes) {
      const { id, spec } = note;
      const file = this.lane.read(id);
      // Rotli can only answer for a file it can see: not while another app's
      // change hasn't reached it yet, or once another app deleted it.
      const unseen = this.acks.some(
        (ack) => ack.kind === "notice" && ack.noteId === id && ack.state === "held",
      );
      if (this.on("I2") && file && !unseen && hasBuffer(id) && !isDirty(id) && !goneNotes().includes(id)) {
        if (file.body !== bufferText(id))
          return `I2 ${spec.name}: reads saved, but the file holds “${file.body.split("\n")[2]}” and the buffer “${bufferText(id)!.split("\n")[2]}”`;
        const open = this.acks.find(
          (ack) =>
            ack.kind === "write" && ack.noteId === id && ack.state !== "settled" && ack.body !== file.body,
        );
        if (open)
          return `I2 ${spec.name}: reads saved while ${open.label} can still land and change the file`;
      }
      if (this.on("I3") && this.owes(note)) {
        const shown = this.shown();
        const here =
          bufferText(id) === note.words ||
          file?.body === note.words ||
          this.copies(this.lane).some((copy) => shown.has(copy.id) && copy.words === note.words);
        if (!here)
          return `I3 ${spec.name}: the words “${note.words.split("\n")[2]}” are in neither the buffer nor the disk`;
      }
    }
    const pending = this.acks.filter((ack) => MUTATIONS.includes(ack.kind) && ack.state !== "settled");
    let n = 0;
    for (const order of landings(pending)) {
      n += 1;
      const lane = cloneLane(this.lane, `${this.prefix}-death${n}`);
      const events = new Map(this.copyEvents);
      for (const ack of order) {
        try {
          const made = ack.apply(lane);
          if (ack.event && made) events.set((made as Note).id, ack.event);
        } catch {
          // refused by the contract: it doesn't land
        }
      }
      const later = order.length
        ? ` if ${order.map((ack) => ack.label.split(" ")[0]).join(", then ")} land${order.length === 1 ? "s" : ""}`
        : "";
      const copyFault = this.copyFault(lane, events);
      if (copyFault && this.on("I5")) return `I5 ${copyFault}${later} after the process dies`;
      if (this.quit === "acked" && this.on("I1")) {
        for (const note of this.notes) {
          if (!this.owes(note)) continue;
          if (lane.read(note.id)?.body === note.words) continue;
          if (
            this.copies(this.lane).some((copy) => this.shownAtQuit.has(copy.id) && copy.words === note.words)
          )
            continue;
          const holds = lane.read(note.id)?.body.split("\n")[2];
          return `I1 ${note.spec.name}: quit was acknowledged, but${later || " as it stands"} the file holds ${holds ? `“${holds}”` : "nothing"}, not “${note.words.split("\n")[2]}”, and no recovery note has them`;
        }
      }
    }
    return null;
  }

  private copyFault(lane: FakeLane, events: Map<string, string>): string | null {
    for (const note of this.notes) {
      const mine = this.copies(lane).filter((copy) => copy.source === note.spec.name);
      const perEvent = new Map<string, number>();
      for (const copy of mine) {
        const event = events.get(copy.id) ?? `${note.spec.name}#?`;
        perEvent.set(event, (perEvent.get(event) ?? 0) + 1);
      }
      for (const [event, count] of perEvent)
        if (count > 1 || event.endsWith("#0") || event.endsWith("#?"))
          return `${note.spec.name}: ${count} recovery cop${count === 1 ? "y" : "ies"} for event ${event.split("#")[1]}${event.endsWith("#0") ? " (no outside change or deletion had happened)" : ""}`;
      for (const copy of mine) {
        const secure = copy.meta.includes("secure: true");
        const locked = copy.meta.includes("locked: true");
        if (secure !== !!note.spec.secure || locked !== !!note.spec.locked)
          return `${note.spec.name}: a recovery copy is ${secure ? "" : "not "}secure and ${locked ? "" : "not "}locked; its source is ${note.spec.secure ? "" : "not "}secure and ${note.spec.locked ? "" : "not "}locked`;
      }
    }
    return null;
  }

  /** The end of a schedule: settle everything, run every timer, then I4 and a last quit. */
  async finish(): Promise<string | null> {
    for (let i = 0; i < 400; i += 1) {
      const held = this.acks.find((ack) => ack.state === "held");
      if (held) this.settle(held, "release");
      else if (this.clock.timers.size > 0) this.clock.fire();
      else break;
      await drain();
      const fault = this.check();
      if (fault) return `${fault} (while everything settles)`;
    }
    if (this.quit === "acked") return null;
    for (const note of this.notes) {
      const { id, spec } = note;
      if (!queueBusy(id)) continue;
      // what holds the queue: a write or creation of this note's that never
      // settles (a creation is this note's when it carries the note's title)
      const mine = (ack: Ack) =>
        ack.state === "never" && (ack.noteId === id || ack.event?.startsWith(`${spec.name}#`) === true);
      const never =
        this.acks.find((ack) => mine(ack) && MUTATIONS.includes(ack.kind)) ?? this.acks.find(mine);
      const named = isDirty(id) && (documentSaveError(id) ?? "").includes(spec.name);
      if (never && MUTATIONS.includes(never.kind) && named) continue;
      return never
        ? `I4 ${spec.name}: its queue is held for good by ${never.label}, which never settles${MUTATIONS.includes(never.kind) && !named ? ", and the note doesn't say so by name" : ""}`
        : `I4 ${spec.name}: its queue is still busy after everything settled`;
    }
    if (this.quit === "idle") {
      let refusal = "";
      this.startQuit((message) => (refusal = message));
      for (let i = 0; i < 400 && this.waiting(); i += 1) {
        await drain();
        const held = this.acks.find((ack) => ack.state === "held");
        if (held) this.settle(held, "release");
        else if (this.clock.timers.size > 0) this.clock.fire();
      }
      await drain();
      if (!this.acked()) {
        // each reason must be a note that is exempt: deleted with words, or
        // holding a write or create that never settles
        // the flushers' wrapper ("1 save operation failed: …") isn't a reason
        const reasons = (refusal || "it never answers").replace(/^\d+ save operations? failed: /, "");
        for (const reason of reasons.split("; ")) {
          const note = this.notes.find((each) => reason.startsWith(`“${each.spec.name}”`));
          const exempt =
            note &&
            (goneNotes().includes(note.id) ||
              this.acks.some(
                (ack) =>
                  ack.state === "never" &&
                  MUTATIONS.includes(ack.kind) &&
                  (ack.noteId === note.id || ack.event?.startsWith(`${note.spec.name}#`)),
              ));
          if (!exempt) return `I4 quit is refused after everything settled: ${reason}`;
        }
      }
    }
    return this.check();
  }

  dispose(): void {
    this.unregisterFlusher();
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
