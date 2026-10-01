// The main webview's half of the agent bridge (docs/decisions/
// 2026-10-01-agent-app-bridge.md): an outside agent's Word document request,
// which Rust has admitted (the open vault, writable for writes, a clean
// document, an AI-made one for edits), carried out with the same codec and the
// same edit path as the chat. Rust checks the answer again before it leaves.

import { DOCX_EDITABLE } from "../documents/kinds";
import {
  type AgentAnswer,
  type AgentRequest,
  agentBridgeReady,
  agentBridgeReply,
  onAgentRequest,
} from "../lib/agentBridge";
import { extOf, fileNameStem } from "../lib/fileKind";
import { editableDocumentForAi } from "./artifacts";
import { editDocumentAsAi } from "./documentEdits";
import { looksSecret } from "./guard";

const fail = (error: string): AgentAnswer => ({ ok: false, error });

/** What an agent reads: numbered blocks and the revision an edit must name.
 * An agent counts as remote, so secret-shaped text never goes out. */
function documentAnswer(
  file: string,
  blocks: string,
  revision: string,
  warnings: string[] = [],
): AgentAnswer {
  if (looksSecret(blocks)) return fail("blocked: this document holds secret-shaped text.");
  return { ok: true, result: { file, title: fileNameStem(file), revision, blocks, warnings } };
}

async function readDocument(file: string): Promise<AgentAnswer> {
  const { editManagedDocument } = await import("../documents/composition");
  const editable = await editManagedDocument(file);
  if (editable.kind !== "ready") return fail("this document is too large for an agent.");
  return documentAnswer(file, editableDocumentForAi(editable.document), editable.revision, editable.warnings);
}

export async function answerAgentRequest(request: AgentRequest): Promise<AgentAnswer> {
  const { tool, args } = request;
  if (tool === "create_document") {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!title) return fail("name the document: title is required.");
    const body = typeof args.body === "string" ? args.body : "";
    if (looksSecret(`${title}\n${body}`)) return fail("blocked: the document would hold secret-shaped text.");
    const { createManagedDocumentWithContent } = await import("../newItems/composition");
    // filed into Main like the chat's, never opened in the person's face
    const created = await createManagedDocumentWithContent(title, body, {
      open: false,
      byAi: true,
      agent: request.agent,
    });
    return readDocument(created.id);
  }
  const file = typeof args.file === "string" ? args.file : "";
  if (!DOCX_EDITABLE.has(extOf(file))) return fail("Rotli's agents read and edit Word documents (.docx).");
  if (tool === "read_document") return readDocument(file);
  if (tool === "apply_document") {
    const expected = args.expectedRevision;
    if (typeof expected !== "string" || !expected) return fail("pass expectedRevision from the read.");
    const actions = Array.isArray(args.actions) ? args.actions : [];
    const edit = await editDocumentAsAi({ id: file, title: fileNameStem(file) }, actions, expected);
    if (edit.kind === "refused") return fail(edit.reason);
    return documentAnswer(file, editableDocumentForAi(edit.document), edit.revision);
  }
  return fail(`unknown document tool: ${tool}`);
}

/** Answer every agent request that reaches this window; returns the stop. */
export function attachAgentBridge(): () => void {
  return onAgentRequest(
    (request) => {
      void answerAgentRequest(request)
        .catch((error: unknown): AgentAnswer => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }))
        .then((answer) => agentBridgeReply(request.requestId, answer))
        .catch(() => {});
    },
    () => void agentBridgeReady().catch(() => {}),
  );
}
