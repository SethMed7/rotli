// The one-time "move your Archive and Trash?" question in a copy with the
// Librarian on (services/personSinks.ts). Asked once per vault; never in a
// folder connected in place. Waits for the copy dialog to close first.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { activeInstance } from "../memex/config";
import { useMemexConfig } from "../memex/useMemex";
import { answerPersonSinks, personSinksQuestion, personSinksToAsk } from "../services/personSinks";
import { useUiStore } from "../state/ui";
import { useVaultImport } from "../state/vaultImport";
import { WebDialogFrame } from "./webDialogFrame";

export function PersonSinksDialog() {
  const config = useMemexConfig().data;
  const active = config ? activeInstance(config) : null;
  const answer = useUiStore((state) => state.personSinksAnswer);
  const importIdle = useVaultImport((state) => state.step.kind === "idle");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sinks = useQuery({
    queryKey: ["person-sinks", active?.root ?? null, active?.memexId ?? null, answer],
    queryFn: () => personSinksToAsk(active, answer),
    enabled: importIdle,
  });
  const vaultId = active?.memexId;
  if (!importIdle || !sinks.data || !vaultId) return null;
  const { title, line } = personSinksQuestion(sinks.data);
  const answerWith = (move: boolean) => {
    setErr(null);
    setBusy(true);
    answerPersonSinks(vaultId, move)
      .catch((cause: unknown) => setErr(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <WebDialogFrame
      id="person-sinks"
      title={title}
      busy={busy}
      onClose={() => answerWith(false)}
      actions={
        <>
          <button type="button" className="rename-btn" disabled={busy} onClick={() => answerWith(false)}>
            No, leave them
          </button>
          <button
            type="button"
            className="rename-btn primary"
            disabled={busy}
            onClick={() => answerWith(true)}
          >
            Yes, move them
          </button>
        </>
      }
    >
      <p className="web-connect-line">{line}</p>
      <p className="web-connect-line">Rotli asks once. Your original vault is never touched.</p>
      {err && (
        <p className="web-connect-line" role="alert">
          ⚠ Couldn’t move them. {err}
        </p>
      )}
    </WebDialogFrame>
  );
}
