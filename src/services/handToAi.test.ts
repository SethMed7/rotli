import { describe, expect, test } from "bun:test";

import type { CompleteReq } from "../ai/types";
import { useLibrarianRules } from "../state/librarianRules";
import { DEST } from "./destinations";
import {
  attachmentIsSecure,
  handToAiFor,
  type LocateAttachment,
  refineHandToAiFor,
  secureByNameOrUnknown,
} from "./handToAi";
import { notesService } from "./notes";

/** A synthetic vault on disk: `storage/shot.png` exists, nothing else does. */
const locate: LocateAttachment = (_rootId, rel) =>
  Promise.resolve(
    rel === "storage/shot.png"
      ? { status: "found", rel, path: `/Synthetic Vault/${rel}` }
      : { status: "missing", rel },
  );

function stubModel(reply: (req: CompleteReq) => string) {
  const sent: CompleteReq[] = [];
  return {
    sent,
    host: {
      complete(req: CompleteReq) {
        sent.push(req);
        return Promise.resolve(reply(req));
      },
    },
  };
}

/** A model that rewrites well: every path from the handoff, kept verbatim. */
const faithful = (req: CompleteReq) => {
  const paths = (req.messages[1]?.content ?? "").match(/\/Synthetic Vault\/[^\s)>]+/g) ?? [];
  return `## Task\nFix the overlap on the login page.\n## Attachments\n${paths.map((p) => `- ${p}`).join("\n")}\n`;
};

describe("Hand to AI — the files a note links to", () => {
  test("a found file gets its absolute path; a missing one is listed as missing", async () => {
    const note = await notesService.createNote(
      DEST.inbox,
      "# Login\n\nFix the overlap.\n\n![Overlap|300](storage:shot.png)\n\n[spec](storage:gone.pdf)",
    );
    const result = await handToAiFor(note.id, locate);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.paths).toEqual(["/Synthetic Vault/storage/shot.png"]);
    expect(result.prompt).toContain("- /Synthetic Vault/storage/shot.png (image, “Overlap”)");
    expect(result.prompt).toContain("- storage/gone.pdf (file, “spec”): missing, not found in the vault");
    expect(result.prompt).toContain("![Overlap](</Synthetic Vault/storage/shot.png>)");
  });

  test("a note linking a file in a secure folder is refused, and nothing is located", async () => {
    let asked = 0;
    const counting: LocateAttachment = (...args) => {
      asked += 1;
      return locate(...args);
    };
    const note = await notesService.createNote(
      DEST.inbox,
      "# Taxes\n\nFile them.\n\n![w2](Secure notes/w2.png) ![shot](storage:shot.png)",
    );
    expect(await handToAiFor(note.id, counting)).toEqual({ kind: "secureAttachment", title: "Taxes" });
    expect(asked).toBe(0);
  });

  test("secure folders match in any case, and a secure keyword in a file name counts", () => {
    expect(attachmentIsSecure("secure notes/w2.png", [])).toBe(true);
    expect(attachmentIsSecure("wiki/_secure/id/passport.jpg", [])).toBe(true);
    expect(attachmentIsSecure("storage/bank-statement.pdf", ["bank"])).toBe(true);
    expect(attachmentIsSecure("storage/riverbank.png", ["bank"])).toBe(false);
    expect(attachmentIsSecure("storage/shot.png", [])).toBe(false);
  });
});

describe("Hand to AI, Refined — what reaches the model", () => {
  test("a refined prompt keeps the attachment paths", async () => {
    const note = await notesService.createNote(DEST.inbox, "# Login\n\nFix it.\n\n![](storage:shot.png)");
    const model = stubModel(faithful);
    const result = await refineHandToAiFor(note.id, model.host, locate);
    expect(result.kind).toBe("refined");
    if (result.kind === "refined") expect(result.prompt).toContain("/Synthetic Vault/storage/shot.png");
    expect(model.sent).toHaveLength(1);
  });

  test("a secure note never reaches the model", async () => {
    const note = await notesService.createNote(DEST.inbox, "# Bank\n\nAccount notes.", { secure: true });
    const model = stubModel(faithful);
    expect(await refineHandToAiFor(note.id, model.host, locate)).toEqual({ kind: "secure", title: "Bank" });
    expect(model.sent).toHaveLength(0);
  });

  test("a note linking a secure file never reaches the model", async () => {
    const note = await notesService.createNote(DEST.inbox, "# Scan\n\n![id](wiki/_secure/id.png)");
    const model = stubModel(faithful);
    expect((await refineHandToAiFor(note.id, model.host, locate)).kind).toBe("secureAttachment");
    expect(model.sent).toHaveLength(0);
  });

  test("an answer that drops a path falls back to Basic, with the reason", async () => {
    const note = await notesService.createNote(DEST.inbox, "# Login\n\nFix it.\n\n![](storage:shot.png)");
    const model = stubModel(() => "## Task\nFix the login page, see the screenshot attached.\n");
    const result = await refineHandToAiFor(note.id, model.host, locate);
    expect(result.kind).toBe("fallback");
    if (result.kind !== "fallback") return;
    expect(result.reason).toBe("The model's answer dropped a file path.");
    const basic = await handToAiFor(note.id, locate);
    expect(basic.kind === "ready" && basic.prompt).toBe(result.prompt);
    expect(result.prompt).toContain("## Attachments");
  });

  test("a model that fails falls back to Basic", async () => {
    const note = await notesService.createNote(DEST.inbox, "# Plan\n\nShip Friday.");
    const host = { complete: () => Promise.reject(new Error("offline")) };
    const result = await refineHandToAiFor(note.id, host, locate);
    expect(result).toMatchObject({ kind: "fallback", reason: "The model couldn't answer: offline" });
  });
});

describe("Hand to AI — which notes may leave Rotli", () => {
  test("an ordinary note becomes a prompt", async () => {
    const note = await notesService.createNote(
      DEST.inbox,
      "# Plan the launch\n\nPick a date.\n\n- [ ] Book the room",
    );
    const result = await handToAiFor(note.id);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.prompt).toContain("- [ ] Book the room");
  });

  test("a secure note is refused and no prompt is built", async () => {
    const note = await notesService.createNote(DEST.inbox, "# Bank\n\nAccount notes.", { secure: true });
    expect(await handToAiFor(note.id)).toEqual({ kind: "secure", title: "Bank" });
  });

  test("a note named with a secure keyword is refused before a save has flagged it", async () => {
    const before = useLibrarianRules.getState().rules;
    useLibrarianRules.getState().setRules({ ...before, secureKeywords: ["bank"] });
    try {
      const note = await notesService.createNote(DEST.inbox, "# Bank login\n\nWhere the card lives.");
      expect(await handToAiFor(note.id)).toEqual({ kind: "secure", title: "Bank login" });
      const plain = await notesService.createNote(DEST.inbox, "# Riverbank walk\n\nSaturday.");
      expect((await handToAiFor(plain.id)).kind).toBe("ready");
    } finally {
      useLibrarianRules.getState().setRules(before);
    }
  });

  test("a file name that can't be read counts as secure", () => {
    expect(secureByNameOrUnknown("Plans", null, ["bank"])).toBe(true);
    expect(secureByNameOrUnknown("Plans", "wiki/bank-login.md", ["bank"])).toBe(true);
    expect(secureByNameOrUnknown("Plans", "wiki/plans.md", ["bank"])).toBe(false);
  });

  test("a note whose text looks like a secret is refused", async () => {
    // a test card number (Luhn-valid, never a real account)
    const note = await notesService.createNote(DEST.inbox, "# Checkout\n\ncard 4242 4242 4242 4242");
    expect((await handToAiFor(note.id)).kind).toBe("secret");
  });

  test("an empty note has nothing to hand off", async () => {
    const note = await notesService.createNote(DEST.inbox, "   ");
    expect((await handToAiFor(note.id)).kind).toBe("empty");
  });
});
