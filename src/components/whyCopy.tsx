// "Why a copy?" (docs/design/vault-copy-and-obsidian-compatibility.md,
// decision H): the Librarian works on a folder that already holds notes only
// through a copy Rotli makes, and this says why, wherever that copy is offered.

import { productName } from "../host/registry";

export const whyCopyLines = (name = productName()) => [
  `The Librarian files, moves, and renames notes as it organizes. A folder you bring already holds your work, so ${name} never lets the Librarian touch it: it organizes a copy ${name} makes instead.`,
  `Your original folder is never moved, renamed, edited, or deleted by ${name}. Whatever happens in the copy, the original stays exactly as you left it, and you can always go back to it.`,
];

export function WhyCopy() {
  return (
    <details className="why-copy">
      <summary>Why a copy?</summary>
      {whyCopyLines().map((line) => (
        <p key={line}>{line}</p>
      ))}
    </details>
  );
}
