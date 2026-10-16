// Chat's two empty states, before there is any conversation to show: chat
// can't run here (the web without Rotli Helper), or there is no vault at all.
// Chat keeps its conversations in a vault, so the no-vault state connects one
// right here — the same Connect flow as the vault menu (pick a folder; a folder
// of notes asks Connect, or Connect a copy with the Librarian) — instead of
// sending the person to Settings.

import { type ReactNode, useState } from "react";

import { PLATFORM } from "../../lib/featurePolicy";
import { useChatSetupGuide } from "../../state/chatSetupGuide";
import { useConnectVault } from "../sidebar/useConnectVault";
import { ChatBuddy } from "./chatBuddy";

function ChatEmpty({
  moment,
  hour,
  children,
}: {
  moment: "unavailable" | "no-vault";
  hour: number;
  children: ReactNode;
}) {
  return (
    <div className="list-empty chat-empty">
      <ChatBuddy moment={moment} hour={hour} size={120} />
      {children}
    </div>
  );
}

/** The one call to action an empty state offers. */
function ChatCta({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="chat-cta" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

export function ChatUnavailable({ hour }: { hour: number }) {
  return (
    <ChatEmpty moment="unavailable" hour={hour}>
      {PLATFORM === "web" ? (
        <>
          <p>Chat runs the AI tools on your own computer. On the web that takes Rotli Helper.</p>
          <ChatCta label="Set up chat on the web" onClick={() => useChatSetupGuide.getState().show()} />
        </>
      ) : (
        <p>Chat uses your vault as context — it runs in the app.</p>
      )}
    </ChatEmpty>
  );
}

export function ChatNoVault({ hour }: { hour: number }) {
  const { connectVault } = useConnectVault();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const connect = () => {
    setErr(null);
    setBusy(true);
    connectVault()
      .catch((cause: unknown) => setErr(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <ChatEmpty moment="no-vault" hour={hour}>
      <p>No vault connected yet. Chat keeps its conversations in your vault.</p>
      <ChatCta label={busy ? "Connecting…" : "Connect vault"} onClick={connect} disabled={busy} />
      {err && (
        <p className="file-err" role="alert">
          ⚠ Couldn’t connect that folder. {err}
        </p>
      )}
    </ChatEmpty>
  );
}
