import { useEffect, useMemo, useRef, useState } from "react";

import {
  LIBRARIAN_LABELS,
  librarianCaption,
  librarianModelFor,
  librarianOptions,
  suggestedLibrarian,
} from "../../ai/librarianLane";
import {
  CLI_CATALOG,
  PROVIDER_LABELS,
  type ProviderId,
  installableCatalog,
  providerDefaultModel,
} from "../../ai/models";
import { setSetupHandle } from "../../keys/handles";
import {
  type ChatModelInfo,
  type CliDetect,
  localModelInstall,
  localModelInstallCancel,
  localModelInstallProgress,
  localModelSetDefault,
  localModelUninstall,
} from "../../lib/tauri";
import { ONBOARDING_STEP_NUMBER, ONBOARDING_TOTAL_STEPS } from "../../state/onboarding";
import {
  providerReady,
  recheckProvider,
  refreshLocalModels,
  startSetupDetection,
  useSetupDetection,
} from "../../state/setupDetection";
import { useUiStore } from "../../state/ui";
import { Character } from "../character";
import { ChevronRight } from "../glyphs";
import { ConnectorGuide } from "../settings/connectorGuide";
import { chatMark } from "../sidebar/chatMark";
import { ModelLogo } from "../sidebar/modelLogo";
import { SetupBack, SetupPrimary } from "./setupControls";
import { SetupSideFriends } from "./setupSideFriends";

const CONNECTED_PROVIDERS = [
  "claude",
  "codex",
  "cursor",
  "antigravity",
] as const satisfies readonly ProviderId[];
type ModelSection = "local" | "install" | "subscription";

/** Antigravity's install and sign-in live in Settings, not a terminal, so its
 * help stays a sentence; the terminal lanes render the shared walkthrough. */
const ANTIGRAVITY_HELP =
  "Google's official Antigravity ACP agent, which Rotli downloads and signs in from Settings → AI Models → Antigravity after setup. The `agy` command line and the Antigravity IDE are separate products with their own logins; Rotli does not use them. The lane stays off until you turn it on.";

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
  const providerDefaults = useUiStore((state) => state.providerDefaults);
  const setProviderDefault = useUiStore((state) => state.setProviderDefault);
  const organizerModel = useUiStore((state) => state.organizerModel);
  const setOrganizerModel = useUiStore((state) => state.setOrganizerModel);
  const organizerModelId = useUiStore((state) => state.organizerModelId);
  const setOrganizerModelId = useUiStore((state) => state.setOrganizerModelId);
  // detection began on the first setup screen (state/setupDetection); by now
  // the answers are usually in, so this step opens knowing what is here
  const local = useSetupDetection((state) => state.local);
  const detections = useSetupDetection((state) => state.detections);
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

  const refreshLocal = () => void refreshLocalModels();

  // a direct open of this step (Settings → run setup again) still starts it
  useEffect(() => startSetupDetection(), []);

  // Gemini is proposed as the Librarian once (per mount) when it is signed in
  // and nothing was chosen; the lane itself stays off until the user turns it
  // on above, so the proposal costs nothing until that second consent
  const proposedRef = useRef(false);
  useEffect(() => {
    if (proposedRef.current) return;
    const proposal = suggestedLibrarian(detections, organizerModel);
    if (proposal === organizerModel) return;
    proposedRef.current = true;
    setOrganizerModel(proposal);
  }, [detections, organizerModel, setOrganizerModel]);

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
  const readyProviders = CONNECTED_PROVIDERS.filter((provider) => providerReady(detections[provider])).length;
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
            <Character name="knowledge" size={152} accessorized={false} alwaysVisible />
            <p>Choose one, several, or none. Your vault works without a model.</p>
          </aside>

          <div className="setup-content">
            <p className="setup-eyebrow">Optional and changeable</p>
            <h1 id="model-setup-title">How should Rotli think?</h1>
            <p className="setup-lede">
              Run a model entirely on this Mac, or use your own Claude, ChatGPT, Cursor, or Gemini accounts
              through each company&rsquo;s official local client. Rotli already looked at what this Mac has;
              every connected lane stays off until you turn it on.
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
                  aria-expanded={openSection === "subscription"}
                  aria-controls="connected-model-panel"
                  onClick={() => toggleSection("subscription")}
                >
                  <span>
                    <strong id="connected-model-title">Connect Claude, ChatGPT, Cursor, or Gemini</strong>
                    <small>Use official command-line clients already signed in on this Mac.</small>
                  </span>
                  <span className="setup-model-summary-meta">
                    {readyProviders > 0 ? `${readyProviders} detected` : "Optional"}
                    <ChevronRight className="setup-disclosure-chevron" size={13} />
                  </span>
                </button>
                {openSection === "subscription" && (
                  <div className="setup-model-panel" id="connected-model-panel">
                    <div className="setup-provider-list">
                      {CONNECTED_PROVIDERS.map((provider) => {
                        const detection = detections[provider];
                        const ready = providerReady(detection);
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
                            {ready && enabled && (
                              <label className="setup-provider-default">
                                <span>
                                  Default
                                  <small>Used by @{provider}</small>
                                </span>
                                <select
                                  className="setselect"
                                  value={providerDefaultModel(provider, providerDefaults)}
                                  aria-label={`Default model for ${PROVIDER_LABELS[provider]}`}
                                  onChange={(event) =>
                                    setProviderDefault(provider, event.currentTarget.value)
                                  }
                                >
                                  {CLI_CATALOG[provider].map((model) => (
                                    <option key={model.id} value={model.id}>
                                      {model.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                            {expanded === provider &&
                              (provider === "antigravity" ? (
                                <p className="setup-provider-help">{ANTIGRAVITY_HELP}</p>
                              ) : (
                                <div className="setup-provider-help">
                                  <ConnectorGuide
                                    lane={provider}
                                    detection={detection}
                                    onRecheck={() => void recheckProvider(provider)}
                                  />
                                </div>
                              ))}
                          </div>
                        );
                      })}
                    </div>
                    <p className="setup-provider-help">
                      Rotli never reads or stores provider credentials and never presents a provider login.
                      Antigravity signs in through Google&rsquo;s own agent, from Settings, and stays off by
                      default.
                    </p>
                  </div>
                )}
              </section>
            </div>

            <section className="setup-librarian" aria-labelledby="librarian-title">
              <strong id="librarian-title">Who files your notes?</strong>
              <small>The Librarian tidies the Library on its own schedule. Choose where it thinks.</small>
              <div className="setup-librarian-options" role="group" aria-label="Librarian model">
                {librarianOptions(detections, organizerModel).map((lane) => (
                  <button
                    key={lane}
                    type="button"
                    className={organizerModel === lane ? "setup-model-action selected" : "setup-model-action"}
                    aria-pressed={organizerModel === lane}
                    onClick={() => {
                      setOrganizerModel(lane);
                      // picking a client IS the consent to use it
                      if (lane !== "local") setAiProvider(lane, true);
                    }}
                  >
                    {LIBRARIAN_LABELS[lane]}
                  </button>
                ))}
              </div>
              {organizerModel !== "local" && (
                <label className="setselect-row">
                  <span>Model</span>
                  <select
                    className="setselect"
                    aria-label="Librarian model"
                    value={librarianModelFor(organizerModel, organizerModelId, providerDefaults)}
                    onChange={(event) => setOrganizerModelId(event.currentTarget.value)}
                  >
                    {CLI_CATALOG[organizerModel].map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="setup-provider-help">
                {librarianCaption(organizerModel, organizerModel === "local" || providers[organizerModel])}
              </p>
            </section>

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
