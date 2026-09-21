// The effectful half of "name chats by meaning" (ai/chatTitle.ts is the pure
// half): ask the chat's own model once, then improve the stored title — unless
// the person named the chat themselves. Fire-and-forget; every failure keeps
// the name they already saw.

import { titleChatByMeaning } from "../ai/chatTitle";
import { makeTauriHost } from "../ai/host";
import { visibleChatText } from "../lib/chatWork";
import type { ChatModelInfo } from "../lib/tauri";
import type { MemexInstance } from "../memex/config";
import { listChats, updateChatTitle } from "../memex/service";
import { invalidateMemex } from "../memex/useMemex";
import { useUiStore } from "../state/ui";

/** Positional on purpose: chatSurface.tsx sits at its size ceiling, and this
 * call has to fit on one line there.
 * @param existingSlug the chat's slug BEFORE this send — set means the chat
 *   already existed, and an existing chat is never renamed
 * @param model the model this chat's turn just ran on — never any other
 * @param createdTitle the title the chat was created with
 * @param typedTitle what the person typed in the name field; anything there
 *   means the chat is already named
 * @param secure this chat carries secure-note content: a remote model is refused */
export function nameNewChat(
  instance: MemexInstance,
  existingSlug: string | null | undefined,
  slug: string,
  model: ChatModelInfo,
  firstPrompt: string,
  createdTitle: string,
  typedTitle: string,
  secure: boolean,
): void {
  if (existingSlug || typedTitle.trim() || !useUiStore.getState().chatTitleByMeaning) return;
  const host = makeTauriHost(model, { requestId: crypto.randomUUID(), isSecureContext: () => secure });
  void titleChatByMeaning(host, visibleChatText(firstPrompt))
    .then(async (title) => {
      if (!title || title === createdTitle) return;
      // a name the person gave while the model was thinking always wins
      const stored = (await listChats(instance)).find((chat) => chat.slug === slug)?.title;
      if (stored !== createdTitle) return;
      await updateChatTitle(instance, slug, title);
      await invalidateMemex();
    })
    .catch(() => {});
}
