// The utility footer (the maintainer, 2026-07-28, from the Obsidian reference): Files ·
// Librarian · Settings share one quiet row at the very bottom. It is APP-level,
// not front-level, so it shows under Home and Chat alike (the maintainer, 2026-08-01:
// "the utility footer stays as is").
//
// The Librarian entry is the old Activity row — it's the Librarian's journal, so
// it wears the Librarian's name; internal ids keep "activity".

import { dispatch } from "../../keys/registry";
import { isTauri, revealCorpus } from "../../lib/tauri";
import { deriveJournal } from "../../services/brainJournal";
import { useJournal, useSecureHints } from "../../services/hooks";
import { useOrganizerLive } from "../../state/organizerLive";
import { usePanesStore } from "../../state/panes";
import { useUiStore } from "../../state/ui";
import { ActivityGlyph, FolderGlyph } from "../glyphs";
import { Icon } from "../icon";

export function SidebarFooter() {
  // unreviewed daemon proposals — the badge on the Librarian link (§4.4.2);
  // sensitive-data decisions waiting on the user wear the RED variant instead
  // (the maintainer, 2026-07-31: "or I will never know")
  const pendingProposals = deriveJournal(useJournal().data ?? []).pending.length;
  // detector-only hints awaiting a decision (deriveSecureReview's `confirm`,
  // inlined so the always-mounted sidebar doesn't anchor the secure-repair
  // DISK SCAN poll too — repair only feeds the leftover line, not this badge
  // (review F7; perf-audit family #12-14)
  const secureConfirms = (useSecureHints().data ?? []).filter((h) => !h.flagged).length;
  // the ambient Librarian working signal — pulses the footer dot (2026-07-31)
  const organizerWorking = useOrganizerLive((s) => s.active);
  const organizerCurrent = useOrganizerLive((s) => s.current);
  const brainEnabled = useUiStore((s) => s.brainEnabled);
  return (
    <div className="sb-foot">
      {isTauri() && (
        <button
          type="button"
          className="sb-footbtn"
          title="Open the vault folder in Finder"
          onClick={() => void revealCorpus()}
        >
          <FolderGlyph size={14} />
          <span className="fname">Files</span>
        </button>
      )}
      <button
        type="button"
        className="sb-footbtn"
        title={
          organizerWorking
            ? `Organizing${organizerCurrent ? ` — looking at “${organizerCurrent}”` : "…"}`
            : secureConfirms > 0
              ? `${secureConfirms} sensitive-data ${secureConfirms === 1 ? "decision waits" : "decisions wait"} for you`
              : pendingProposals > 0
                ? `${pendingProposals} ${pendingProposals === 1 ? "suggestion waits" : "suggestions wait"} for your approval`
                : brainEnabled
                  ? "See and undo the Librarian's work"
                  : "The Librarian's journal"
        }
        onClick={() => usePanesStore.getState().openActivity()}
      >
        <ActivityGlyph size={14} />
        <span className="fname">Librarian</span>
        {/* the ambient working dot (the maintainer, 2026-07-31): the Librarian's
            work is visible from anywhere — pulses while a cycle or an
            adopt batch runs, from the SAME narration the surface shows */}
        {organizerWorking && <span className="sb-work-dot" aria-hidden="true" />}
        {/* RED = a sensitive-data decision waits (never auto-resolved);
            otherwise the pending-approval count so Suggest mode is
            never a silent queue */}
        {secureConfirms > 0 ? (
          <span className="count alert">{secureConfirms}</span>
        ) : (
          pendingProposals > 0 && <span className="count pill">{pendingProposals}</span>
        )}
      </button>
      <button
        type="button"
        className="sb-footbtn"
        title="Settings"
        data-tour="settings"
        data-hotkey="app.settings"
        onClick={() => dispatch("app.settings")}
      >
        <Icon name="rotli-settings" size={14} />
        <span className="fname">Settings</span>
      </button>
    </div>
  );
}
