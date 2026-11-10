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
// I1 Once quit was acknowledged, whatever lands afterwards (any subset of the
//    writes and creates already handed to the disk, in any order), each note's
//    file holds the last words the person had in it, or those words are in a
//    recovery note that existed when quit was acknowledged, or they chose
//    Discard for them.
// I2 A note reads saved (not dirty) only when its file equals the buffer and
//    no write for it is unresolved (an unresolved write counts as able to
//    change the file).
// I3 Words the person typed are never absent from both the buffer and the disk
//    (the note's file or a recovery note), unless they chose Discard. Words are
//    owed until newer typing replaces them, or until another app changes or
//    deletes the file while those words are on it (then that app replaced
//    them, not Rotli). Words equal to a version another app overwrote, or to
//    what Rotli last saved when Rotli sees another app's change, aren't owed
//    either: a three-way merge reads them as no change of the person's and
//    takes the other app's text, by design.
// I4 Once every acknowledgement has settled and every timer has run, no note's
//    queue is busy, and quit succeeds. Exempt, on purpose: a note whose write
//    or create never settles, while it says so by name, stays unsaved and quit
//    names it (Rotli can't know whether that write will land).
// I5 A recovery or conflict copy is made at most once per event (an outside
//    change or a deletion), and carries its source's protection and lock,
//    whatever lands after a process death.

import { queryClient } from "../services/query";
import { baselineOf, bufferText, hasBuffer } from "./buffers";
import { flushNoteAfterPaint } from "./flushAfterPaint";
import {
  discardGoneNote,
  ensureDocument,
  evictDocument,
  flushSyncs,
  keepGoneNote,
  onDocumentChange,
  reloadDocumentIfClean,
  setCreateNoteForTests,
  setDocumentText,
  setFindNoteForTests,
  setReadNoteForTests,
  setWriteNoteBodyForTests,
} from "./model";
import { setClockForTests } from "./saveClock";
import { HandClock } from "./saveExplorerClock.fixtures";
import { goneNotes, queueBusy, resetSaveQueueForTests } from "./saveQueue";
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
  | "keep"
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
  caps?: Partial<Record<"type" | "undo" | "outside" | "purge" | "keep" | "switch" | "close", number>>;
  /** At most this many acknowledgements may be failed or left never settling. */
  faults?: number;
  /** Invariants to leave unchecked (to see what a schedule does past the first one it breaks). */
  ignore?: string[];
}

type AckKind = "write" | "read" | "create" | "notice";
interface Ack {
  serial: number;
  kind: AckKind;
  label: string;
  noteId: string | null;
  /** A write's words. */
  body?: string;
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
  /** Every version another app overwrote. */
  replaced: Set<string>;
  /** Every id the note's tab has shown (Keep moves it to the note it made). */
  ids: string[];
}

let worlds = 0;
export const drain = async () => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
const MUTATIONS: AckKind[] = ["write", "create"];
const titleOf = (body: string) =>
  body
    .split("\n")[0]!
    .replace(/^# /, "")
    .replace(/ \(unsaved edits [^)]*\)$/, "");
/** A copy's words as the person typed them (a conflict copy's title is suffixed). */
const copyWords = (body: string) => body.replace(/^# (.*) \(unsaved edits [^)]*\)$/m, "# $1");

function cloneLane(lane: FakeLane, prefix: string): FakeLane {
  const copy = fakeLane(prefix);
  for (const [id, file] of lane.files) copy.files.set(id, { ...file, meta: [...file.meta] });
  return copy;
}

/** Every order of every subset of `items`. */
function* landings<T>(items: T[]): Generator<T[]> {
  yield [];
  for (let i = 0; i < items.length; i += 1)
    for (const rest of landings([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i]!, ...rest];
}

export class World {
  readonly lane: FakeLane;
  readonly clock = new HandClock();
  readonly acks: Ack[] = [];
  readonly notes: Tracked[] = [];
  readonly trace: string[] = [];
  quit: "idle" | "waiting" | "acked" = "idle";
  copiesAtQuit: { body: string; meta: string[] }[] = [];
  faults = 0;
  private readonly prefix: string;

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
    setCreateNoteForTests((folder, body, protection) =>
      this.hold("create", null, `${titleOf(body)} “${body.split("\n")[2] ?? ""}”`, (lane) =>
        lane.create(folder, body, protection),
      ),
    );
    setFindNoteForTests((folder, body) =>
      this.hold("read", null, "find", (lane) => {
        const hit = [...lane.files.entries()].find(
          ([, file]) => file.folder === folder && file.body === body,
        );
        return hit ? lane.read(hit[0]) : null;
      }),
    );
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
        replaced: new Set(),
        ids: [made.id],
      });
    }
  }

  private nameOf(noteId: string | null): string {
    return this.notes.find((note) => note.id === noteId)?.spec.name ?? "";
  }

  private owes(note: Tracked): boolean {
    return note.owed && !note.discarded && !note.replaced.has(note.words);
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
              // Rotli sees the change now. Words that equal what the other app
              // replaced, or what Rotli last saved, are no change of the
              // person's: the merge takes the other app's text, by design.
              if (note.replaced.has(note.words) || note.words === baselineOf(id)) note.owed = false;
              const file = lane.read(id);
              if (file) reloadDocumentIfClean(id, file.body, file.revision);
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
      const gone = goneNotes().includes(id);
      if (gone && may(note, "keep"))
        out.push({
          label: `keep ${spec.name}`,
          run: () => {
            spend(note, "keep");
            keepGoneNote(id).then(
              (kept) => {
                if (!kept) return;
                // the tab follows the words to the note that was made
                if (note.open) note.unsubscribe();
                note.id = kept;
                note.ids.push(kept);
                if (note.open) note.unsubscribe = onDocumentChange(kept, () => {});
              },
              () => {},
            );
          },
        });
      if (gone && allowed.has("discard"))
        out.push({
          label: `discard ${spec.name}`,
          run: () => {
            discardGoneNote(id);
            // it counts only if it took effect (not while the words are being kept)
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
      if (ack.kind === "notice" || !faultsLeft) continue;
      if (allowed.has("fail")) out.push({ label: `fail ${ack.label}`, run: () => this.settle(ack, "fail") });
      if (allowed.has("landFail") && MUTATIONS.includes(ack.kind))
        out.push({ label: `land-then-fail ${ack.label}`, run: () => this.settle(ack, "landFail") });
      if (allowed.has("never"))
        out.push({ label: `never ${ack.label}`, run: () => this.settle(ack, "never") });
    }
    if (allowed.has("advance") && this.clock.timers.size > 0)
      out.push({ label: "advance", run: () => this.trace.push(`  (+${this.clock.fire()} ms)`) });
    return out;
  }

  /** Ask to quit: acknowledged, quit is a leaf (the process ends); refused, the person may ask again. */
  private startQuit(refused?: (message: string) => void): void {
    this.quit = "waiting";
    flushSyncs().then(
      () => {
        this.quit = "acked";
        this.copiesAtQuit = this.copies(this.lane).map(({ body, meta }) => ({ body, meta }));
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
    const before = this.lane.read(note.id)?.body;
    if (before === undefined) return;
    if (before === note.words) note.owed = false;
    note.replaced.add(before);
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
    if (how === "landFail") return ack.reject(new Error("it was written, but the answer was lost"));
    ack.resolve(value);
  }

  /** Files that aren't one of the world's notes: recovery and conflict copies. */
  copies(lane: FakeLane) {
    const ids = new Set(this.notes.flatMap((note) => note.ids));
    return [...lane.files.entries()]
      .filter(([id]) => !ids.has(id))
      .map(([, file]) => ({ ...file, source: titleOf(file.body), words: copyWords(file.body) }));
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
        const here =
          bufferText(id) === note.words ||
          file?.body === note.words ||
          this.copies(this.lane).some((copy) => copy.words === note.words);
        if (!here)
          return `I3 ${spec.name}: the words “${note.words.split("\n")[2]}” are in neither the buffer nor the disk`;
      }
    }
    const pending = this.acks.filter((ack) => MUTATIONS.includes(ack.kind) && ack.state !== "settled");
    let n = 0;
    for (const order of landings(pending)) {
      n += 1;
      const lane = cloneLane(this.lane, `${this.prefix}-death${n}`);
      for (const ack of order) {
        try {
          ack.apply(lane);
        } catch {
          // refused by the contract: it doesn't land
        }
      }
      const later = order.length
        ? ` if ${order.map((ack) => ack.label.split(" ")[0]).join(", then ")} land${order.length === 1 ? "s" : ""}`
        : "";
      const copyFault = this.copyFault(lane);
      if (copyFault && this.on("I5")) return `I5 ${copyFault}${later} after the process dies`;
      if (this.quit === "acked" && this.on("I1")) {
        for (const note of this.notes) {
          if (!this.owes(note)) continue;
          if (lane.read(note.id)?.body === note.words) continue;
          if (this.copiesAtQuit.some((copy) => copyWords(copy.body) === note.words)) continue;
          const holds = lane.read(note.id)?.body.split("\n")[2];
          return `I1 ${note.spec.name}: quit was acknowledged, but${later || " as it stands"} the file holds ${holds ? `“${holds}”` : "nothing"}, not “${note.words.split("\n")[2]}”, and no recovery note has them`;
        }
      }
    }
    return null;
  }

  private copyFault(lane: FakeLane): string | null {
    for (const note of this.notes) {
      const kept = note.ids
        .slice(1)
        .map((id) => lane.files.get(id))
        .filter((file) => file !== undefined);
      const mine = [...this.copies(lane).filter((copy) => copy.source === note.spec.name), ...kept];
      if (mine.length > note.events)
        return `${note.spec.name}: ${mine.length} recovery copies for ${note.events} event${note.events === 1 ? "" : "s"}`;
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
        ack.state === "never" &&
        (ack.noteId === id || (ack.kind === "create" && ack.label.split(" ")[1] === spec.name));
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
        const excused = this.notes.some(
          (note) =>
            goneNotes().includes(note.id) ||
            this.acks.some((ack) => ack.state === "never" && MUTATIONS.includes(ack.kind)),
        );
        if (!excused) return `I4 quit is refused after everything settled: ${refusal || "it never answers"}`;
      }
    }
    return this.check();
  }

  dispose(): void {
    for (const note of this.notes) if (note.open) note.unsubscribe();
    for (const id of [...this.lane.files.keys(), ...this.notes.flatMap((note) => note.ids)])
      if (hasBuffer(id)) evictDocument(id);
    resetSaveQueueForTests();
    setWriteNoteBodyForTests(null);
    setReadNoteForTests(null);
    setCreateNoteForTests(null);
    setFindNoteForTests(null);
    setClockForTests(null);
    queryClient.clear();
  }
}
