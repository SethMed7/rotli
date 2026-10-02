// The chat's empty state when no model can answer: instead of a dead send
// button, a way in. The Mac app offers the full chooser (models on this Mac,
// installing one, connecting a client); the web, the walkthrough the Settings
// lane cards show for each connected tool, with a door to Settings.

import { useQueries } from "@tanstack/react-query";

import { PROVIDER_LABELS, type ProviderId } from "../../ai/models";
import { PLATFORM } from "../../lib/featurePolicy";
import { canDetectConnectors, connectorDetectionQuery } from "../../services/connectorSetup";
import { useUiStore } from "../../state/ui";
import { ConnectorGuide } from "../settings/connectorGuide";
import { ChatModelChoices } from "./chatModelChoices";

const LANES: readonly ProviderId[] = ["claude", "codex", "cursor"];

export function ChatSetupGuide({
  secureOnly = false,
  onOpenSettings,
}: {
  /** A secure chat never sees a connected model, so the tools' guide would mislead. */
  secureOnly?: boolean;
  onOpenSettings: () => void;
}) {
  // the Mac app offers every way in, local models first (chatModelChoices.tsx)
  if (!secureOnly && PLATFORM !== "web") return <ChatModelChoices onOpenSettings={onOpenSettings} />;
  return <LaneGuide secureOnly={secureOnly} onOpenSettings={onOpenSettings} />;
}

function LaneGuide({ secureOnly, onOpenSettings }: { secureOnly: boolean; onOpenSettings: () => void }) {
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
