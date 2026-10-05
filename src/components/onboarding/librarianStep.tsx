// Setup's Librarian screen (the owner, 2026-10-01: whether first, then where
// it thinks). Every lane is offered with what this Mac has for it (the owner,
// 2026-10-02: "check what is available; if they have nothing they still
// choose"), and a lane that isn't ready yet is finished later from the
// sidebar's Librarian.

import { useEffect, useRef } from "react";

import {
  LANE_STATUS_LABELS,
  LIBRARIAN_LABELS,
  ORGANIZER_MODELS,
  librarianCaption,
  librarianLaneStatus,
  librarianModelFor,
  librarianSetupStep,
  suggestedLibrarian,
} from "../../ai/librarianLane";
import { providerCatalog } from "../../ai/models";
import { readyFrom, useConnectedCatalog } from "../../services/connectedModels";
import { setLibrarianOn } from "../../services/librarianSwitch";
import { useSetupDetection } from "../../state/setupDetection";
import { useUiStore } from "../../state/ui";
import { LIBRARIAN_ON_DESCRIPTION, SetupChoiceGroup } from "./setupControls";

export function LibrarianScreen() {
  const brainEnabled = useUiStore((state) => state.brainEnabled);
  const organizerModel = useUiStore((state) => state.organizerModel);
  const setOrganizerModel = useUiStore((state) => state.setOrganizerModel);
  // detection began on the first screen; by now the answers are usually in
  const detections = useSetupDetection((state) => state.detections);

  // Gemini is proposed once (per mount) when it is signed in and nothing was
  // chosen; picking any client below is the consent to use it
  const proposed = useRef(false);
  useEffect(() => {
    if (proposed.current) return;
    const proposal = suggestedLibrarian(detections, organizerModel);
    if (proposal === organizerModel) return;
    proposed.current = true;
    setOrganizerModel(proposal);
  }, [detections, organizerModel, setOrganizerModel]);

  return (
    <>
      <h1 id="setup-title">Who files your notes?</h1>
      <p className="setup-lede">
        The Librarian keeps your Library tidy on its own schedule: it files new notes and suggests moves for
        you to approve. It never rewrites what you wrote, and secure and locked notes never leave this Mac.
      </p>
      <SetupChoiceGroup
        label="Librarian"
        value={brainEnabled ? "on" : "off"}
        onChange={(choice) => setLibrarianOn(choice === "on")}
        options={[
          {
            value: "on",
            title: "Use the Librarian",
            description: LIBRARIAN_ON_DESCRIPTION,
          },
          {
            value: "off",
            title: "Not now",
            description: "You arrange your notes yourself. Turn it on anytime in Settings → Librarian.",
          },
        ]}
      />
      {brainEnabled && <LibrarianModel />}
      <p className="setup-local-note">
        Models for chat come the first time you open Chat. Everything else is in Settings → AI Models.
      </p>
    </>
  );
}

/** Where the Librarian thinks: this Mac or a connected client, each with what
 * this Mac has for it, and the client's model. */
function LibrarianModel() {
  const providers = useUiStore((state) => state.aiProviders);
  const setAiProvider = useUiStore((state) => state.setAiProvider);
  const providerDefaults = useUiStore((state) => state.providerDefaults);
  const organizerModel = useUiStore((state) => state.organizerModel);
  const setOrganizerModel = useUiStore((state) => state.setOrganizerModel);
  const organizerModelId = useUiStore((state) => state.organizerModelId);
  const setOrganizerModelId = useUiStore((state) => state.setOrganizerModelId);
  const detections = useSetupDetection((state) => state.detections);
  const local = useSetupDetection((state) => state.local);
  const localChecked = useSetupDetection((state) => state.localChecked);
  const { lanes } = useConnectedCatalog(providers, readyFrom(detections));
  const evidence = { detections, local, localChecked };
  const statuses = ORGANIZER_MODELS.map((lane) => librarianLaneStatus(lane, evidence));
  const nothingReady = statuses.every((status) => status !== "ready" && status !== "checking");
  const step = librarianSetupStep(organizerModel, librarianLaneStatus(organizerModel, evidence));
  return (
    <section className="setup-librarian" aria-labelledby="librarian-title">
      <strong id="librarian-title">The Librarian thinks</strong>
      <div className="setup-librarian-options" role="group" aria-label="Librarian model">
        {ORGANIZER_MODELS.map((lane, index) => (
          <button
            key={lane}
            type="button"
            className={`setup-lane${organizerModel === lane ? " selected" : ""}`}
            aria-pressed={organizerModel === lane}
            data-status={statuses[index]}
            onClick={() => {
              setOrganizerModel(lane);
              if (lane !== "local") setAiProvider(lane, true);
            }}
          >
            <span className="setup-lane-name">{LIBRARIAN_LABELS[lane]}</span>{" "}
            <span className="setup-lane-status">{LANE_STATUS_LABELS[statuses[index]!]}</span>
          </button>
        ))}
      </div>
      {nothingReady && (
        <p className="setup-librarian-caption setup-librarian-empty">
          Nothing is set up on this Mac yet. Choose one anyway: after setup, the Librarian in the sidebar
          shows you how to finish.
        </p>
      )}
      {organizerModel !== "local" && (
        <label className="setselect-row">
          <span>Model</span>
          <select
            className="setselect"
            aria-label="Librarian model"
            value={librarianModelFor(organizerModel, organizerModelId, providerDefaults)}
            onChange={(event) => setOrganizerModelId(event.currentTarget.value)}
          >
            {providerCatalog(organizerModel, lanes).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="setup-librarian-caption">
        {step && !nothingReady
          ? `${step} Until then nothing gets filed, and the Librarian in the sidebar reminds you.`
          : librarianCaption(organizerModel, organizerModel === "local" || providers[organizerModel])}
      </p>
    </section>
  );
}
