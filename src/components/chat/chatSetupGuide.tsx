// The chat's empty state when no model can answer: instead of a dead send
// button, the same walkthrough the Settings lane cards show — install, sign
// in, come back — for each connected tool the user has switched on, with a
// door to Settings for the rest.

import { useQueries } from "@tanstack/react-query";

import { PROVIDER_LABELS, type ProviderId } from "../../ai/models";
import { canDetectConnectors, connectorDetectionQuery } from "../../services/connectorSetup";
import { useUiStore } from "../../state/ui";
import { ConnectorGuide } from "../settings/connectorGuide";

const LANES: readonly ProviderId[] = ["claude", "codex", "cursor"];

export function ChatSetupGuide({
  secureOnly = false,
  onOpenSettings,
}: {
  /** A secure chat never sees a connected model, so the tools' guide would mislead. */
  secureOnly?: boolean;
  onOpenSettings: () => void;
}) {
  const aiProviders = useUiStore((s) => s.aiProviders);
  const enabledLanes = LANES.filter((id) => aiProviders[id]);
  const lanes = enabledLanes.length > 0 ? enabledLanes : ["claude" as ProviderId];
  const checks = useQueries({
    queries: lanes.map((id) => connectorDetectionQuery(id)),
  });
  if (secureOnly) {
    return (
      <section className="chat-setup" aria-label="Set up a model">
        <p className="chat-sub">
          This chat touches a secure note, so only an on-device model may answer, and none is installed yet.
          Install one under Settings → AI Models → Local; the connected tools stay out of secure chats.
        </p>
        <div className="chat-welcome-actions">
          <button type="button" className="ghostbtn" onClick={onOpenSettings}>
            Open AI Models settings
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="chat-setup" aria-label="Set up a model">
      <p className="chat-sub">
        No model can answer yet. Set one up on this computer — Rotli only runs tools you install and sign in
        to yourself.
      </p>
      {lanes.map((id, index) => {
        const check = checks[index];
        return (
          <details key={id} className="chat-setup-lane" open={index === 0}>
            <summary>{PROVIDER_LABELS[id]}</summary>
            <ConnectorGuide
              lane={id}
              detection={check?.data}
              onRecheck={canDetectConnectors() ? () => void check?.refetch() : undefined}
              checking={check?.isFetching ?? false}
            />
          </details>
        );
      })}
      <div className="chat-welcome-actions">
        <button type="button" className="ghostbtn" onClick={onOpenSettings}>
          Open AI Models settings
        </button>
      </div>
    </section>
  );
}
