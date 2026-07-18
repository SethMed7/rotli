import {
  corpusFileText,
  corpusFilerMove,
  corpusFrontmatter,
  corpusJournalAppend,
  corpusNotePath,
  corpusSetAiField,
  corpusWriteIndex,
  organizerLearnField,
} from "../lib/tauri";
import { fileNoteToArea } from "./brainFiling";
import {
  type BrainAction,
  type JournalDeps,
  approveProposal as approveWithDeps,
  dismissProposal as dismissWithDeps,
  undoAction as undoWithDeps,
} from "./brainJournal";

const liveJournalDeps: JournalDeps = {
  fileNote: fileNoteToArea,
  setAiField: corpusSetAiField,
  writeIndex: corpusWriteIndex,
  filerMove: corpusFilerMove,
  notePath: corpusNotePath,
  frontmatter: corpusFrontmatter,
  append: corpusJournalAppend,
  readIndex: (area) => corpusFileText(`wiki/${area}/_index.md`).catch(() => ""),
  learnField: organizerLearnField,
};

export const approveProposal = (action: BrainAction): Promise<void> =>
  approveWithDeps(action, liveJournalDeps);

export const dismissProposal = (action: BrainAction): Promise<void> =>
  dismissWithDeps(action, liveJournalDeps);

export const undoAction = (action: BrainAction): Promise<void> => undoWithDeps(action, liveJournalDeps);
