import { useEffect, useMemo, useRef, useState } from "react";

import { PROVIDER_LABELS, type ProviderId, installableCatalog } from "../../ai/models";
import { setSetupHandle } from "../../keys/handles";
import {
  type ChatModelInfo,
  type CliDetect,
  chatModels,
  cliDetect,
  localModelInstall,
  localModelInstallCancel,
  localModelInstallProgress,
  localModelSetDefault,
  localModelUninstall,
} from "../../lib/tauri";
import { ONBOARDING_STEP_NUMBER, ONBOARDING_TOTAL_STEPS } from "../../state/onboarding";
import { useUiStore } from "../../state/ui";
import { Character } from "../character";
import { ChevronRight } from "../glyphs";
import { chatMark } from "../sidebar/chatMark";
import { ModelLogo } from "../sidebar/modelLogo";
import { SetupBack, SetupPrimary } from "./setupControls";
import { SetupSideFriends } from "./setupSideFriends";

const CONNECTED_PROVIDERS = ["claude", "codex", "agy"] as const satisfies readonly ProviderId[];
type ConnectedProvider = (typeof CONNECTED_PROVIDERS)[number];
type ModelSection = "local" | "install" | "subscriptions";

const SETUP_HELP: Record<ConnectedProvider, string> = {
  claude: "Install Claude Code, then run `claude` once in Terminal and sign in.",
  codex: "Install Codex with `brew install codex`, then run `codex login`.",
  agy: "Install Antigravity, then run `agy` once in Terminal and sign in.",
};

function localSize(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function providerSetupStatus(detection: CliDetect | undefined): string {
  if (!detection) return "Checking…";
  if (!detection.installed) return "Not installed";
  if (!detection.authenticated) return "Sign in needed";
  return "Ready";
}

function SetupModelMark({ provider, label }: { provider?: string; label: string }) {
  const mark = chatMark(provider, label);
  return (
    <span className={`setup-model-mark ${mark.logo ? "has-logo" : "fallback"}`} title={mark.title}>
      {mark.logo ? <ModelLogo logo={mark.logo} /> : mark.initial}
    </span>
  );
}

export function ModelSetup({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const providers = useUiStore((state) => state.aiProviders);
  const setAiProvider = useUiStore((state) => state.setAiProvider);
  const [local, setLocal] = useState<ChatModelInfo[]>([]);
  const [detections, setDetections] = useState<Partial<Record<ProviderId, CliDetect>>>({});
  const [expanded, setExpanded] = useState<ProviderId | null>(null);
  const [installing, setInstalling] = useState<{
    requestId: string;
    name: string;
    label: string;
    approxMb: number;
  } | null>(null);
  const [installedBytes, setInstalledBytes] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [openSection, setOpenSection] = useState<ModelSection | null>("local");
  const [showScrollCue, setShowScrollCue] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const refreshLocal = () =>
    void chatModels()
      .then(setLocal)
      .catch(() => setLocal([]));

  useEffect(() => {
    refreshLocal();
    for (const provider of CONNECTED_PROVIDERS) {
      void cliDetect(provider)
        .then((detection) => setDetections((current) => ({ ...current, [provider]: detection })))
        .catch(() =>
          setDetections((current) => ({
            ...current,
            [provider]: { installed: false, authenticated: false, version: null },
          })),
        );
    }
  }, []);

  useEffect(() => {
    setSetupHandle({ continue: onDone, back: onBack });
    return () => setSetupHandle(null);
  }, [onBack, onDone]);

  useEffect(() => {
    if (!installing) return;
    const poll = window.setInterval(() => {
      void localModelInstallProgress(installing.name)
        .then((progress) => setInstalledBytes(progress.bytes))
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(poll);
  }, [installing]);

  const installedIds = useMemo(() => new Set(local.map((model) => model.id)), [local]);
  const installable = installableCatalog(installedIds);
  const readyProviders = CONNECTED_PROVIDERS.filter((provider) => {
    const detection = detections[provider];
    return !!detection?.installed && detection.authenticated;
  }).length;
  const installPct =
    installing && installing.approxMb > 0
      ? Math.min(99, Math.round((installedBytes / (installing.approxMb * 1_000_000)) * 100))
      : 0;

  const installModel = (entry: (typeof installable)[number]) => {
    if (installing) return;
    const requestId = crypto.randomUUID();
    setNote(null);
    setInstalledBytes(0);
    setInstalling({ requestId, name: entry.name, label: entry.label, approxMb: entry.approxMb });
    void localModelInstall({
      requestId,
      repo: entry.repo,
      name: entry.name,
      approxMb: entry.approxMb,
      vision: entry.vision,
    })
      .then(() => {
        setNote({ text: `${entry.label} is ready on this Mac.`, error: false });
        refreshLocal();
      })
      .catch((cause) =>
        setNote({ text: cause instanceof Error ? cause.message : String(cause), error: true }),
      )
      .finally(() => setInstalling(null));
  };

  const makeDefault = (model: ChatModelInfo) => {
    setNote(null);
    void localModelSetDefault(model.id)
      .then(() => {
        setNote({ text: `${model.label} is now the default local model.`, error: false });
        refreshLocal();
      })
      .catch((cause) =>
        setNote({ text: cause instanceof Error ? cause.message : String(cause), error: true }),
      );
  };

  const removeModel = (model: ChatModelInfo) => {
    if (confirmRemove !== model.id) {
      setConfirmRemove(model.id);
      return;
    }
    setNote(null);
    void localModelUninstall(model.id)
      .then(() => {
        setConfirmRemove(null);
        setNote({ text: `${model.label} was moved to Trash.`, error: false });
        refreshLocal();
      })
      .catch((cause) =>
        setNote({ text: cause instanceof Error ? cause.message : String(cause), error: true }),
      );
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const overflow = stage.scrollHeight - stage.clientHeight > 8;
      const moreBelow = stage.scrollTop + stage.clientHeight < stage.scrollHeight - 8;
      setShowScrollCue(overflow && moreBelow);
    };
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    for (const child of stage.children) observer.observe(child);
    stage.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      stage.removeEventListener("scroll", update);
    };
  });

  const toggleSection = (section: ModelSection) =>
    setOpenSection((current) => (current === section ? null : section));

  return (
    <div className="onb model-setup">
      <div className="onb-drag" data-tauri-drag-region />
      <section className="setup-shell" aria-labelledby="model-setup-title">
        <div className="setup-progress">
          <span>
            {ONBOARDING_STEP_NUMBER.models} of {ONBOARDING_TOTAL_STEPS}
          </span>
          <span aria-hidden="true">·</span>
          <span>Models</span>
        </div>

        <SetupSideFriends />

        <div className="setup-stage" ref={stageRef}>
          <aside className="setup-companion" aria-hidden="true">
            <Character name="knowledge" size={152} />
            <p>Choose one, several, or none. Your vault works without a model.</p>
          </aside>

          <div className="setup-content">
            <p className="setup-eyebrow">Optional and changeable</p>
            <h1 id="model-setup-title">How should Rotli think?</h1>
            <p className="setup-lede">
              Run a model entirely on this Mac, or connect a subscription you already use. Connected models
              run remotely; secure notes never leave your Mac.
            </p>

            <div className="setup-model-disclosures">
              <section className="setup-model-disclosure" aria-labelledby="local-model-title">
                <button
                  type="button"
                  className="setup-model-summary"
                  aria-expanded={openSection === "local"}
                  aria-controls="local-model-panel"
                  onClick={() => toggleSection("local")}
                >
                  <span>
                    <strong id="local-model-title">On this Mac</strong>
                    <small>Reuse models already registered here.</small>
                  </span>
                  <span className="setup-model-summary-meta">
                    {local.length > 0 ? `${local.length} ready` : "None found"}
                    <ChevronRight className="setup-disclosure-chevron" size={13} />
                  </span>
                </button>
                {openSection === "local" && (
                  <div className="setup-model-panel" id="local-model-panel">
                    {local.length > 0 ? (
                      <div className="setup-local-model-list" aria-label="Models already on this Mac">
                        {local.map((model) => (
                          <div className="setup-model-row" key={`${model.provider}:${model.id}`}>
                            <span className="setup-model-identity">
                              <SetupModelMark provider={model.provider} label={model.label} />
                              <span className="setup-model-copy">
                                <strong>{model.label}</strong>
                                <small>
                                  {model.provider === "mlx"
                                    ? "MLX · ready to use"
                                    : `${model.provider} · ready to use`}
                                </small>
                              </span>
                            </span>
                            <span className="setup-model-actions">
                              {model.localDefault ? (
                                <span className="setup-status ready">Default</span>
                              ) : (
                                model.provider === "mlx" && (
                                  <button
                                    type="button"
                                    className="setup-model-action"
                                    onClick={() => makeDefault(model)}
                                  >
                                    Use by default
                                  </button>
                                )
                              )}
                              {!model.localDefault && model.provider === "mlx" && (
                                <button
                                  type="button"
                                  className={
                                    confirmRemove === model.id
                                      ? "setup-model-action danger"
                                      : "setup-model-action quiet"
                                  }
                                  onClick={() => removeModel(model)}
                                >
                                  {confirmRemove === model.id ? "Remove?" : "Remove"}
                                </button>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="setup-model-empty">No registered local models were found.</p>
                    )}
                  </div>
                )}
              </section>

              <section className="setup-model-disclosure" aria-labelledby="install-model-title">
                <button
                  type="button"
                  className="setup-model-summary"
                  aria-expanded={openSection === "install"}
                  aria-controls="install-model-panel"
                  onClick={() => toggleSection("install")}
                >
                  <span>
                    <strong id="install-model-title">Install a model</strong>
                    <small>Download one model at a time for private, on-device use.</small>
                  </span>
                  <span className="setup-model-summary-meta">
                    {installable.length} available
                    <ChevronRight className="setup-disclosure-chevron" size={13} />
                  </span>
                </button>
                {openSection === "install" && (
                  <div className="setup-model-panel" id="install-model-panel">
                    {installable.length > 3 && (
                      <span className="setup-list-scroll-label">Scroll to browse ↓</span>
                    )}
                    <div className="setup-install-list" aria-label="Models available to install">
                      {installable.map((entry) => {
                        const active = installing?.name === entry.name;
                        return (
                          <div className="setup-model-row" key={entry.name}>
                            <span className="setup-model-identity">
                              <SetupModelMark provider="mlx" label={entry.label} />
                              <span className="setup-model-copy">
                                <strong>{entry.label}</strong>
                                <small>
                                  {localSize(entry.approxMb)}
                                  {entry.vision ? " · vision" : ""}
                                </small>
                              </span>
                            </span>
                            {active ? (
                              <button
                                type="button"
                                className="setup-model-action"
                                onClick={() => void localModelInstallCancel(installing.requestId)}
                              >
                                Cancel · {installPct}%
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="setup-model-action"
                                disabled={!!installing}
                                onClick={() => installModel(entry)}
                              >
                                Install
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {installing && (
                      <div
                        className="setup-model-progress"
                        role="progressbar"
                        aria-label={`Installing ${installing.label}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={installPct}
                      >
                        <span style={{ width: `${installPct}%` }} />
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="setup-model-disclosure" aria-labelledby="connected-model-title">
                <button
                  type="button"
                  className="setup-model-summary"
                  aria-expanded={openSection === "subscriptions"}
                  aria-controls="connected-model-panel"
                  onClick={() => toggleSection("subscriptions")}
                >
                  <span>
                    <strong id="connected-model-title">Connect a subscription</strong>
                    <small>Use an official command-line app already signed in on this Mac.</small>
                  </span>
                  <span className="setup-model-summary-meta">
                    {readyProviders > 0 ? `${readyProviders} detected` : "Optional"}
                    <ChevronRight className="setup-disclosure-chevron" size={13} />
                  </span>
                </button>
                {openSection === "subscriptions" && (
                  <div className="setup-model-panel" id="connected-model-panel">
                    <div className="setup-provider-list">
                      {CONNECTED_PROVIDERS.map((provider) => {
                        const detection = detections[provider];
                        const ready = !!detection?.installed && detection.authenticated;
                        const enabled = providers[provider];
                        return (
                          <div className="setup-provider" key={provider}>
                            <div className="setup-model-row">
                              <span className="setup-model-identity">
                                <SetupModelMark provider={provider} label={PROVIDER_LABELS[provider]} />
                                <span className="setup-model-copy">
                                  <strong>{PROVIDER_LABELS[provider]}</strong>
                                  <small>{providerSetupStatus(detection)}</small>
                                </span>
                              </span>
                              {ready ? (
                                <button
                                  type="button"
                                  className={enabled ? "setup-model-action selected" : "setup-model-action"}
                                  aria-pressed={enabled}
                                  onClick={() => setAiProvider(provider, !enabled)}
                                >
                                  {enabled ? "Connected" : "Connect"}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="setup-model-action"
                                  aria-expanded={expanded === provider}
                                  onClick={() => setExpanded(expanded === provider ? null : provider)}
                                >
                                  Set up
                                </button>
                              )}
                            </div>
                            {expanded === provider && (
                              <p className="setup-provider-help">{SETUP_HELP[provider]}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            </div>

            {note && (
              <p className={note.error ? "setup-error" : "setup-model-note"} role="status">
                {note.text}
              </p>
            )}
            <p className="setup-local-note">
              More models and advanced controls live in Settings → AI Models.
            </p>
          </div>
        </div>

        {showScrollCue && (
          <div className="setup-stage-scroll-cue" aria-hidden="true">
            Scroll for more <span>↓</span>
          </div>
        )}

        <footer className="setup-footer">
          <button type="button" className="setup-skip" onClick={onDone}>
            Skip model setup
          </button>
          <div className="setup-actions">
            <SetupBack onClick={onBack} />
            <SetupPrimary onClick={onDone}>Finish setup</SetupPrimary>
          </div>
        </footer>
      </section>
    </div>
  );
}
