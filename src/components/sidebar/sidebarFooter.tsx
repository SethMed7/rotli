// The utility footer (the maintainer, 2026-07-28, from the Obsidian reference): Files ·
// Librarian · Settings · Feedback share one quiet row at the very bottom.
// Labels show only when all four fit; a narrower sidebar shows the icons alone
// (a container query in notes.css), never a truncated "Fi…". Each button keeps
// its name for screen readers either way (2026-09-28). It is APP-level,
// not front-level, so it shows under Home and Chat alike (the maintainer, 2026-08-01:
// "the utility footer stays as is").
//
// The Librarian entry is the old Activity row — it's the Librarian's journal, so
// it wears the Librarian's name; internal ids keep "activity".

import { dispatch } from "../../keys/registry";
import { webVaultName } from "../../lib/browserVault";
import type { Hidden } from "../../lib/hideable";
import { isTauri, revealCorpus } from "../../lib/tauri";
import { deriveJournal } from "../../services/brainJournal";
import { useChatTranscripts, useJournal, useNoteIndex, useSecureHints } from "../../services/hooks";
import { revealInMacApp } from "../../services/macAppLink";
import { chatSlugOf } from "../../services/systemBrowser";
import { openSystemRoot, revealNoteInSystem } from "../../services/systemNav";
import { webNoteFilePath } from "../../services/webNotes";
import { showFileNotice } from "../../state/fileNotice";
import { useHidden } from "../../state/hidden";
import { librarianQuestions, showLibrarianChat, useLibrarianBar } from "../../state/librarianBar";
import { useOrganizerLive } from "../../state/organizerLive";
import { useFocusedChatSlug, useFocusedNoteId, usePanesStore } from "../../state/panes";
import { useUiStore } from "../../state/ui";
import { ActivityGlyph, FolderGlyph } from "../glyphs";
import { Icon } from "../icon";
import { openLibrarianSettings, useLibrarianSetupStep } from "./useLibrarianSetup";

export function SidebarFooter() {
  const updateAvailable = useUiStore((state) => state.updateAvailable);
  // buttons the person hid (Settings → Appearance → Show in Rotli); Settings stays
  const hidden = useHidden((s) => s.hidden);
  // unreviewed daemon proposals — the badge on the Librarian link (§4.4.2);
  // sensitive-data decisions waiting on the user wear the RED variant instead
  // (the maintainer, 2026-07-31: "or I will never know")
  const pendingProposals = deriveJournal(useJournal().data ?? []).pending.length;
  // detector-only hints awaiting a decision (deriveSecureReview's `confirm`,
  // inlined so the always-mounted sidebar doesn't anchor the secure-repair
  // DISK SCAN poll too — repair only feeds the leftover line, not this badge
  // (review F7; perf-audit family #12-14)
  const secureConfirms = (useSecureHints().data ?? []).filter((h) => !h.flagged).length;
  // the Librarian's open questions in a /librarian conversation (the owner,
  // 2026-09-28: "Anytime the librarian has a question we should see a
  // badge"); a click brings that conversation back into view
  const questions = useLibrarianBar((s) => librarianQuestions(s.chat));
  // the ambient Librarian working signal — pulses the footer dot (2026-07-31)
  const organizerWorking = useOrganizerLive((s) => s.active);
  const organizerCurrent = useOrganizerLive((s) => s.current);
  const brainEnabled = useUiStore((s) => s.brainEnabled);
  // on, but its lane isn't set up yet (no model, a client missing or signed out)
  const setupStep = useLibrarianSetupStep();
  // Files is a shortcut to where you are: Finder on the Mac. On the web the
  // page hands the file to the installed app (rotli://reveal), which opens
  // Finder at it (the owner, 2026-09-17: "it should open the actual finder in
  // the location of the file I am in"); with nothing on disk behind the note
  // (browser-only notes) the vault's own browser opens at its folder instead.
  const focusedNoteId = useFocusedNoteId();
  const focusedChatSlug = useFocusedChatSlug();
  const noteIndex = useNoteIndex();
  const transcripts = useChatTranscripts();
  const showFiles = () => {
    if (isTauri()) return void revealCorpus();
    const note = focusedNoteId
      ? noteIndex.get(focusedNoteId)
      : focusedChatSlug
        ? transcripts.find((n) => chatSlugOf(n) === focusedChatSlug)
        : undefined;
    const filePath =
      focusedChatSlug && !focusedNoteId
        ? Promise.resolve(`chats/${focusedChatSlug}.md`)
        : focusedNoteId
          ? webNoteFilePath(focusedNoteId)
          : Promise.resolve(null);
    void filePath.then((rel) => {
      if (rel) {
        revealInMacApp(webVaultName(), rel);
        showFileNotice("Asked the Rotli app to show it in Finder");
      } else if (note) revealNoteInSystem(note);
      else openSystemRoot("Brain");
    });
  };
  // Settings alone is no footer: the titlebar already has it (the owner,
  // 2026-10-01: "side bar footer if just settings hide it")
  if (!footerShown(hidden)) return null;
  return (
    <div className="sb-foot">
      {!hidden.files && (
        <button
          type="button"
          className="sb-footbtn"
          aria-label="Files"
          title={
            isTauri() ? "Open the vault folder in Finder" : "Show this file in Finder through the Rotli app"
          }
          onClick={showFiles}
        >
          <FolderGlyph size={14} />
          <span className="fname">Files</span>
        </button>
      )}
      {!hidden.librarian && (
        <button
          type="button"
          className="sb-footbtn"
          aria-label={
            secureConfirms > 0
              ? `Librarian — ${secureConfirms} waiting`
              : questions > 0
                ? `Librarian — ${questions} ${questions === 1 ? "question" : "questions"} for you`
                : setupStep
                  ? "Librarian — finish setting up"
                  : pendingProposals > 0
                    ? `Librarian — ${pendingProposals} suggestions`
                    : "Librarian"
          }
          title={
            organizerWorking
              ? `Organizing${organizerCurrent ? ` — looking at “${organizerCurrent}”` : "…"}`
              : secureConfirms > 0
                ? `${secureConfirms} sensitive-data ${secureConfirms === 1 ? "decision waits" : "decisions wait"} for you`
                : questions > 0
                  ? `The Librarian has ${questions === 1 ? "a question" : `${questions} questions`} for you`
                  : setupStep
                    ? `Finish setting up the Librarian: ${setupStep}`
                    : pendingProposals > 0
                      ? `${pendingProposals} ${pendingProposals === 1 ? "suggestion waits" : "suggestions wait"} for your approval`
                      : brainEnabled
                        ? "See and undo the Librarian's work"
                        : "The Librarian's journal"
          }
          onClick={() =>
            questions > 0
              ? showLibrarianChat()
              : setupStep
                ? openLibrarianSettings()
                : usePanesStore.getState().openActivity()
          }
        >
          {/* badges sit on the icon, never beside the label: a count used to
              squeeze "Librarian" to "Libra…" (audit 2026-09-28) */}
          <span className="sb-footicon">
            <ActivityGlyph size={14} />
            {/* the ambient working dot (the maintainer, 2026-07-31): the Librarian's
                work is visible from anywhere — pulses while a cycle or an
                adopt batch runs, from the SAME narration the surface shows */}
            {organizerWorking && <span className="sb-work-dot" aria-hidden="true" />}
            {/* RED = a sensitive-data decision waits (never auto-resolved);
                otherwise the pending-approval count so Suggest mode is
                never a silent queue */}
            {secureConfirms > 0 ? (
              <span className="count alert">{badgeCount(secureConfirms)}</span>
            ) : questions > 0 ? (
              <span className="count ask">{badgeCount(questions)}</span>
            ) : setupStep ? (
              <span className="sb-update-dot" aria-hidden="true" />
            ) : (
              pendingProposals > 0 && <span className="count pill">{badgeCount(pendingProposals)}</span>
            )}
          </span>
          <span className="fname">Librarian</span>
        </button>
      )}
      <SettingsFootButton updateAvailable={updateAvailable} />
      {!hidden.feedback && (
        <button
          type="button"
          className="sb-footbtn"
          aria-label="Feedback"
          title="Send feedback — opens a new issue on GitHub"
          onClick={() => dispatch("app.feedback")}
        >
          <FeedbackGlyph />
          <span className="fname">Feedback</span>
        </button>
      )}
    </div>
  );
}

/** Whether the footer has anything besides Settings to show. */
export function footerShown(hidden: Hidden): boolean {
  return !hidden.files || !hidden.librarian || !hidden.feedback;
}

/** A badge's number, short enough to sit on an icon. */
export function badgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** Settings, wearing the same quiet clay dot as the titlebar's Settings button
 * when a newer build is on the feed (the routine check, services/updateCheck).
 * The dot is decoration; the button's name says it in words. */
export function SettingsFootButton({ updateAvailable }: { updateAvailable: boolean }) {
  return (
    <button
      type="button"
      className="sb-footbtn"
      title={updateAvailable ? "Update available — open Settings" : "Settings"}
      aria-label={updateAvailable ? "Settings — update available" : "Settings"}
      data-tour="settings"
      data-hotkey="app.settings"
      onClick={() => dispatch("app.settings")}
    >
      <span className="sb-footicon">
        <Icon name="rotli-settings" size={14} />
        {updateAvailable && <span className="sb-update-dot" aria-hidden="true" />}
      </span>
      <span className="fname">Settings</span>
    </button>
  );
}

/** A speech bubble with a small heart: "tell us". */
function FeedbackGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5.5h16v10.5H9.5L5 19.5V16H4z" />
      <path d="M12 13.2l-2.1-2a1.3 1.3 0 0 1 2.1-1.6 1.3 1.3 0 0 1 2.1 1.6z" />
    </svg>
  );
}
