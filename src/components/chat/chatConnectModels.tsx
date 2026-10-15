// Connecting a model from Chat itself (the owner, 2026-10-15: "allow me to
// connect new from here", and "my first time going to chat it should offer
// connect first before new chat"). The same chooser setup used to show
// (chatModelChoices.tsx): models on this Mac, installing one, or connecting
// the person's own Claude, ChatGPT, Cursor, or Gemini client.
//   • ConnectModelsDialog — opened from the model picker's "Connect a model…".
//   • ChatFirstVisit — the first time Chat opens in a vault with no chats yet,
//     shown before a new chat even when a model on this Mac could answer.

import { PLATFORM } from "../../lib/featurePolicy";
import { createOpenFlagStore } from "../../state/openFlag";
import { useUiStore } from "../../state/ui";
import { WebDialogFrame } from "../webDialogFrame";
import { ChatModelChoices } from "./chatModelChoices";

/** The picker's "Connect a model…" dialog (session state). */
export const useConnectModels = createOpenFlagStore();

/** "Start chatting" was pressed this session: the first-visit chooser steps aside. */
export const useChatFirstVisitDone = createOpenFlagStore();

/** Whether Chat should offer the chooser before a new chat: the Mac app, a
 * pristine chat, a vault with no chats yet, and not dismissed this session. */
export function firstVisitShows(input: {
  pristine: boolean;
  chatCount: number | undefined;
  done: boolean;
}): boolean {
  return PLATFORM === "desktop" && input.pristine && input.chatCount === 0 && !input.done;
}

export function ConnectModelsDialog() {
  const open = useConnectModels((state) => state.open);
  return open ? <ConnectModelsSheet onClose={() => useConnectModels.getState().hide()} /> : null;
}

export function ConnectModelsSheet({ onClose }: { onClose: () => void }) {
  return (
    <WebDialogFrame
      id="connect-models"
      title="Connect a model"
      onClose={onClose}
      actions={
        <button type="button" className="rename-btn primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <ChatModelChoices
        onOpenSettings={() => {
          onClose();
          useUiStore.getState().setSettingsOpen(true);
        }}
      />
    </WebDialogFrame>
  );
}

export function ChatFirstVisit({ modelLabel }: { modelLabel: string | null }) {
  return (
    <section className="chat-first-visit" aria-label="Choose how Chat answers">
      <ChatModelChoices onOpenSettings={() => useUiStore.getState().setSettingsOpen(true)} />
      {modelLabel && (
        <div className="chat-first-visit-go">
          <button
            type="button"
            className="rename-btn primary"
            onClick={() => useChatFirstVisitDone.getState().show()}
          >
            Start chatting with {modelLabel}
          </button>
        </div>
      )}
    </section>
  );
}
