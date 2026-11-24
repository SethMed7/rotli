import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import * as realTauri from "../lib/tauri";
import type { MemexInstance } from "../memex/config";
import { newChatOriginFrom } from "../state/paneTabs";
import type { Tab } from "../types";
import {
  EMPTY_CHAT_FOLDERS,
  assignChatToFolder,
  createChatFolder,
  parseChatFolders,
  serializeChatFolders,
  setChatFolderInstructionsNote,
} from "./chatFolders";
import * as realCreateNote from "./createNote";

// the vault, in memory: the manifest Rust guards by revision, the chats
// listing, each note's security frontmatter, and the notes made
const disk = {
  contents: "",
  revision: 0,
  writes: 0,
  chats: [] as string[] | Error,
  secure: new Map<string, boolean>(),
  created: [] as string[],
  writeFails: false,
};
void mock.module("../lib/tauri", () => ({
  ...realTauri,
  memexChatFolders: async () => ({ contents: disk.contents, revision: String(disk.revision) }),
  memexWriteChatFolders: async (_root: string, contents: string, expected: string) => {
    if (disk.writeFails || expected !== String(disk.revision))
      throw new Error("The chat folders changed on disk — reopen them.");
    disk.contents = contents;
    disk.revision += 1;
    disk.writes += 1;
    return String(disk.revision);
  },
  memexListChats: async () => {
    if (disk.chats instanceof Error) throw disk.chats;
    return disk.chats.map((slug) => ({ slug }));
  },
  corpusFrontmatter: async (id: string) => (disk.secure.has(id) ? { secure: disk.secure.get(id) } : null),
}));
void mock.module("./createNote", () => ({
  ...realCreateNote,
  createChatNote: async (_instance: MemexInstance, body: string, createdBy?: string) => {
    if (createdBy) throw new Error("project instructions must be the person's note");
    disk.created.push(body);
    return { id: "vault:01KINSTRUCTIONS0000000001", stem: "launch-project-instructions" };
  },
}));
afterAll(() => {
  void mock.module("../lib/tauri", () => realTauri);
  void mock.module("./createNote", () => realCreateNote);
});

const { updateChatProjects } = await import("./chatFolders");
const {
  createProjectInstructions,
  fileNewChat,
  inheritedProjectId,
  projectPreflight,
  turnProject,
  SECURE_PROJECT_NOTICE,
} = await import("./chatProjects");

const INSTANCE: MemexInstance = {
  id: "vault",
  label: "vault",
  root: "/tmp/vault",
  role: "chat-system",
  memexId: "mx_test",
  mode: "secure",
  perms: "chats+inbox",
  brainEnabled: true,
  layout: "memex",
  inPlace: false,
};
const NOTE = "vault:01KLAUNCHNOTE00000000001";
const saved = async () => null;

function launchProject() {
  const created = createChatFolder(EMPTY_CHAT_FOLDERS, "Launch");
  const manifest = assignChatToFolder(created.manifest, "kickoff", created.id);
  return { manifest: setChatFolderInstructionsNote(manifest, created.id, NOTE), id: created.id };
}

beforeEach(() => {
  disk.contents = "";
  disk.revision = 0;
  disk.writes = 0;
  disk.chats = ["kickoff", "follow-up", "second", "loose-chat"];
  disk.secure = new Map([[NOTE, false]]);
  disk.created = [];
  disk.writeFails = false;
});

describe("a new chat joins its project", () => {
  test("from a chat in a project, from a project page, and never into a deleted one", () => {
    const { manifest, id } = launchProject();
    expect(inheritedProjectId(manifest, { chatSlug: "kickoff" })).toBe(id);
    expect(inheritedProjectId(manifest, { projectId: id })).toBe(id);
    expect(inheritedProjectId(manifest, { chatSlug: "loose-chat" })).toBeNull();
    expect(inheritedProjectId(manifest, { projectId: "cf-gone" })).toBeNull();
    expect(inheritedProjectId(manifest, null)).toBeNull();
    // the turn's project: the saved chat's own, else the one it will join
    expect(turnProject(manifest, "kickoff", null)?.id).toBe(id);
    expect(turnProject(manifest, null, { projectId: id })?.id).toBe(id);
    expect(turnProject(manifest, "loose-chat", null)).toBeNull();
  });

  test("the origin is the explicit project, else the focused chat or project page", () => {
    const chatTab: Tab = { id: "t1", surfaceKind: "chat", chatSlug: "kickoff" };
    const freshChat: Tab = { id: "t2", surfaceKind: "chat", chatSlug: null };
    const projectTab: Tab = { id: "t3", surfaceKind: "project", projectId: "cf-a" };
    const noteTab: Tab = { id: "t4", surfaceKind: "note", noteId: "01NOTE" };
    expect(newChatOriginFrom(chatTab)).toEqual({ chatSlug: "kickoff" });
    expect(newChatOriginFrom(freshChat)).toBeNull();
    expect(newChatOriginFrom(projectTab)).toEqual({ projectId: "cf-a" });
    expect(newChatOriginFrom(noteTab)).toBeNull();
    expect(newChatOriginFrom(null)).toBeNull();
    expect(newChatOriginFrom(chatTab, "cf-b")).toEqual({ projectId: "cf-b" });
  });

  test("a saved new chat is filed into the project it came from", async () => {
    const { manifest, id } = launchProject();
    disk.contents = serializeChatFolders(manifest);
    await fileNewChat(INSTANCE, "follow-up", { projectId: id });
    await fileNewChat(INSTANCE, "second", { chatSlug: "kickoff" });
    const after = parseChatFolders(disk.contents);
    expect(after.assignments["follow-up"]).toBe(id);
    expect(after.assignments.second).toBe(id);
  });

  test("filing never fails the send: an unreadable manifest is a no-op", async () => {
    disk.contents = "{not json";
    await fileNewChat(INSTANCE, "follow-up", { projectId: "cf-a" });
    await fileNewChat(INSTANCE, "follow-up", null);
    expect(disk.writes).toBe(0);
  });
});

describe("the pre-flight decides the lane before the run", () => {
  test("a chat in a project carries its note; an open note keeps every lane", async () => {
    disk.contents = serializeChatFolders(launchProject().manifest);
    expect(await projectPreflight(INSTANCE, "kickoff", null, saved)).toEqual({ noteId: NOTE, secure: false });
    expect(await projectPreflight(INSTANCE, "loose-chat", null, saved)).toEqual({
      noteId: null,
      secure: false,
    });
    expect(disk.writes).toBe(0);
  });

  test("a SECURE instructions note marks the turn secure (on-device only, web off)", async () => {
    disk.contents = serializeChatFolders(launchProject().manifest);
    disk.secure.set(NOTE, true);
    expect(await projectPreflight(INSTANCE, "kickoff", null, saved)).toEqual({ noteId: NOTE, secure: true });
    expect(SECURE_PROJECT_NOTICE).toMatch(/on-device/);
  });

  test("a note whose security can't be read, or that is still saving, refuses the turn", async () => {
    disk.contents = serializeChatFolders(launchProject().manifest);
    disk.secure.delete(NOTE);
    expect(await projectPreflight(INSTANCE, "kickoff", null, saved)).toHaveProperty("refusal");
    disk.secure.set(NOTE, false);
    const stillSaving = async () => "Still saving. Try again in a moment.";
    expect(await projectPreflight(INSTANCE, "kickoff", null, stillSaving)).toEqual({
      refusal: "Still saving. Try again in a moment.",
    });
  });

  test("an unreadable manifest means no project, as before projects", async () => {
    disk.contents = "{not json";
    expect(await projectPreflight(INSTANCE, "kickoff", null, saved)).toEqual({ noteId: null, secure: false });
  });
});

describe("the project write path prunes, but only on a complete chat listing", () => {
  const stale = () => {
    const { manifest, id } = launchProject();
    return { manifest: assignChatToFolder(manifest, "deleted-chat", id), id };
  };

  test("a complete listing drops the deleted chat's assignment on the next write", async () => {
    disk.contents = serializeChatFolders(stale().manifest);
    await updateChatProjects(INSTANCE, (m) => m);
    expect(Object.keys(parseChatFolders(disk.contents).assignments)).toEqual(["kickoff"]);
  });

  test("a failed listing or an empty one prunes nothing — the write still lands", async () => {
    for (const listing of [new Error("couldn't list the chats folder: not a directory"), []]) {
      disk.contents = serializeChatFolders(stale().manifest);
      disk.chats = listing;
      await updateChatProjects(INSTANCE, (m) => ({ ...m, folders: [...m.folders] }));
      expect(Object.keys(parseChatFolders(disk.contents).assignments).sort()).toEqual([
        "deleted-chat",
        "kickoff",
      ]);
    }
  });
});

describe("making a project's instructions", () => {
  test("a person's note is made and linked; the manifest holds only its id", async () => {
    const { manifest, id } = launchProject();
    disk.contents = serializeChatFolders(setChatFolderInstructionsNote(manifest, id, null));
    expect(await createProjectInstructions(INSTANCE, id, "Launch")).toBe("vault:01KINSTRUCTIONS0000000001");
    expect(disk.created).toEqual(["# Launch — project instructions\n\n"]);
    const linked = parseChatFolders(disk.contents).folders.find((f) => f.id === id);
    expect(linked?.instructionsNote).toBe("vault:01KINSTRUCTIONS0000000001");
    expect(disk.contents).not.toContain("project instructions\n");
  });

  test("a link that fails after the note exists says which note it is", async () => {
    const { manifest, id } = launchProject();
    disk.contents = serializeChatFolders(manifest);
    disk.writeFails = true; // a revision race on the manifest write
    await expect(createProjectInstructions(INSTANCE, id, "Launch")).rejects.toThrow(
      /“Launch — project instructions” was made but couldn’t be linked/,
    );
    expect(disk.created).toHaveLength(1);
  });
});
