// The save-state explorer's rules (saveExplorer.fixtures.ts holds the world
// and its moves): how quit is played, window by window, as Rust's coordinator
// does (src-tauri/src/quit_flush.rs), and the invariants I1 to I5, stated in
// the world's header.

import { answerCheck, answerFlush } from "../lib/quitFlush";
import type { Note } from "../types";
import { bufferText, hasBuffer } from "./buffers";
import { type Ack, type Attempt, drain, MUTATIONS, type World } from "./saveExplorer.fixtures";
import { cloneLane, landings } from "./saveExplorerClock.fixtures";
import { goneNotes, queueBusy } from "./saveQueue";
import { documentSaveError, isDirty } from "./saveStatus";
import type { FakeLane } from "./writeLane.fixtures";

/** Ask to quit, as Rust's coordinator does: phase 1, every window flushes
 * (main's flushers here, another window's answer a move); phase 2, every
 * window answers at once whether anything is unsaved; the exit follows the
 * last answer. Refused, the person may ask again. */
export function quitStart(world: World, onRefused?: (message: string) => void): void {
  world.quit = "flushing";
  const attempt: Attempt = onRefused ? { onRefused } : {};
  world.attempt = attempt;
  const step = () => advanceAttempt(world, attempt);
  answerFlush().then(
    () => ((attempt.mainFlushed = true), step()),
    (error: Error) => ((attempt.mainFlushed = false), (attempt.refused ??= error.message), step()),
  );
  world
    .hold("flush", null, "another window", () => undefined)
    .then(
      () => ((attempt.otherFlushed = true), step()),
      () => ((attempt.otherFlushed = false), (attempt.refused ??= "another window refused"), step()),
    );
}

function advanceAttempt(world: World, attempt: Attempt): void {
  if (world.attempt !== attempt) return;
  if (attempt.mainFlushed === undefined || attempt.otherFlushed === undefined) return;
  if (attempt.refused !== undefined && world.quit !== "exited")
    return refuse(world, attempt, attempt.refused);
  if (world.quit === "flushing") {
    world.quit = "checking";
    const step = () => advanceAttempt(world, attempt);
    world
      .hold("question", null, "main", () => {
        const reasons = answerCheck();
        if (reasons) attempt.refused ??= reasons;
        attempt.atAnswer = new Map(
          world.notes.map((note) => [
            note,
            { words: note.words, owed: note.owed, discarded: note.discarded, later: new Set<string>() },
          ]),
        );
      })
      .then(
        () => ((attempt.mainAnswered = true), step()),
        () => ((attempt.refused ??= "main did not answer in time"), (attempt.mainAnswered = true), step()),
      );
    world
      .hold("question", null, "another window", () => undefined)
      .then(
        () => ((attempt.otherAnswered = true), step()),
        () => (
          (attempt.refused ??= "another window did not answer in time"),
          (attempt.otherAnswered = true),
          step()
        ),
      );
    return;
  }
  if (!attempt.mainAnswered || !attempt.otherAnswered) return;
  if (attempt.refused !== undefined) return refuse(world, attempt, attempt.refused);
  // the last answer: Rust exits at once
  for (const [note, then] of attempt.atAnswer!) if (note.words !== then.words) world.residual += 1;
  world.quit = "exited";
  world.shownAtQuit = world.shown();
}

function refuse(world: World, attempt: Attempt, message: string): void {
  world.attempt = null;
  world.quit = "idle";
  world.trace.push(`  (quit refused: ${message})`);
  attempt.onRefused?.(message);
}

/** The invariants that hold at every step (I2, I3, I5, and I1 once quit was acknowledged). */
export function checkWorld(world: World): string | null {
  world.observe();
  for (const note of world.notes) {
    const { id, spec } = note;
    const file = world.lane.read(id);
    // Rotli can only answer for a file it can see: not while another app's
    // change hasn't reached it yet, or once another app deleted it.
    const unseen = world.acks.some(
      (ack) => (ack.kind === "notice" || ack.kind === "answer") && ack.noteId === id && ack.state === "held",
    );
    if (
      world.on("I2") &&
      file &&
      !unseen &&
      !note.unseen &&
      hasBuffer(id) &&
      !isDirty(id) &&
      !goneNotes().includes(id)
    ) {
      if (file.body !== bufferText(id))
        return `I2 ${spec.name}: reads saved, but the file holds “${file.body.split("\n")[2]}” and the buffer “${bufferText(id)!.split("\n")[2]}”`;
      const open = world.acks.find(
        (ack) =>
          ack.kind === "write" && ack.noteId === id && ack.state !== "settled" && ack.body !== file.body,
      );
      if (open) return `I2 ${spec.name}: reads saved while ${open.label} can still land and change the file`;
    }
    if (world.on("I3") && world.owes(note)) {
      const shown = world.shown();
      const here =
        bufferText(id) === note.words ||
        file?.body === note.words ||
        world.copies(world.lane).some((copy) => shown.has(copy.id) && copy.words === note.words);
      if (!here)
        return `I3 ${spec.name}: the words “${note.words.split("\n")[2]}” are in neither the buffer nor the disk`;
    }
  }
  const pending = world.acks.filter(
    (ack) => MUTATIONS.includes(ack.kind) && ack.state !== "settled" && !ack.landed,
  );
  let n = 0;
  for (const order of landings(pending)) {
    n += 1;
    const lane = cloneLane(world.lane, `${world.prefix}-death${n}`);
    const events = new Map(world.copyEvents);
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
    const fault = copyFault(world, lane, events);
    if (fault && world.on("I5")) return `I5 ${fault}${later} after the process dies`;
    if (world.quit === "exited" && world.on("I1")) {
      for (const note of world.notes) {
        const then = world.attempt?.atAnswer?.get(note);
        const words = then?.words ?? note.words;
        if (!(then ? then.owed && !then.discarded : world.owes(note))) continue;
        if (lane.read(note.id)?.body === words) continue;
        // what the person typed after main's answer may have landed: newer, fine
        if (then && then.later.has(lane.read(note.id)?.body ?? "")) continue;
        if (world.copies(world.lane).some((copy) => world.shownAtQuit.has(copy.id) && copy.words === words))
          continue;
        const holds = lane.read(note.id)?.body.split("\n")[2];
        return `I1 ${note.spec.name}: Rotli exited, but${later || " as it stands"} the file holds ${holds ? `“${holds}”` : "nothing"}, not “${words.split("\n")[2]}”, and no recovery note has them`;
      }
    }
  }
  return null;
}

function copyFault(world: World, lane: FakeLane, events: Map<string, string>): string | null {
  for (const note of world.notes) {
    const mine = world.copies(lane).filter((copy) => copy.source === note.spec.name);
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
export async function finishWorld(world: World): Promise<string | null> {
  for (let i = 0; i < 400; i += 1) {
    const held = world.acks.find((ack) => ack.state === "held");
    if (held) world.settle(held, "release");
    else if (world.clock.timers.size > 0) world.clock.fire();
    else break;
    await drain();
    const fault = checkWorld(world);
    if (fault) return `${fault} (while everything settles)`;
  }
  if (world.quit === "exited") return null;
  for (const note of world.notes) {
    const { id, spec } = note;
    if (!queueBusy(id)) continue;
    // what holds the queue: a write or creation of this note's that never
    // settles (a creation is this note's when it carries the note's title)
    const mine = (ack: Ack) =>
      ack.state === "never" && (ack.noteId === id || ack.event?.startsWith(`${spec.name}#`) === true);
    const never =
      world.acks.find((ack) => mine(ack) && MUTATIONS.includes(ack.kind)) ?? world.acks.find(mine);
    const named = isDirty(id) && (documentSaveError(id) ?? "").includes(spec.name);
    if (never && MUTATIONS.includes(never.kind) && named) continue;
    return never
      ? `I4 ${spec.name}: its queue is held for good by ${never.label}, which never settles${MUTATIONS.includes(never.kind) && !named ? ", and the note doesn't say so by name" : ""}`
      : `I4 ${spec.name}: its queue is still busy after everything settled`;
  }
  if (world.quit === "idle") {
    let refusal = "";
    quitStart(world, (message) => (refusal = message));
    for (let i = 0; i < 400 && world.waiting(); i += 1) {
      await drain();
      const held = world.acks.find((ack) => ack.state === "held");
      if (held) world.settle(held, "release");
      else if (world.clock.timers.size > 0) world.clock.fire();
    }
    await drain();
    if (!world.acked()) {
      // each reason must be a note that is exempt: deleted with words, or
      // holding a write or create that never settles
      // the flushers' wrapper ("1 save operation failed: …") isn't a reason
      const reasons = (refusal || "it never answers").replace(/^\d+ save operations? failed: /, "");
      for (const reason of reasons.split("; ")) {
        const note = world.notes.find((each) => reason.startsWith(`“${each.spec.name}”`));
        const exempt =
          note &&
          (goneNotes().includes(note.id) ||
            world.acks.some(
              (ack) =>
                ack.state === "never" &&
                MUTATIONS.includes(ack.kind) &&
                (ack.noteId === note.id || ack.event?.startsWith(`${note.spec.name}#`)),
            ));
        if (!exempt) return `I4 quit is refused after everything settled: ${reason}`;
      }
    }
  }
  return checkWorld(world);
}
