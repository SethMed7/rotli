// "Continue a project list" (the owner, 2026-09-29: "a todo list template that
// separates things into projects … it will look at that note: if all its tasks
// are completed it will create a new linked note, else it will use that one").
// Pure rules: whether a note still has open work, and what its next note is
// called ("Round Four - Rotli bugs" → "Round Five - Rotli bugs").

const OPEN_TASK = /^\s*(?:[-*+]|\d+\.)\s+\[( |\/)\]/;

/** Tasks still open (unchecked or in progress). */
export function openTaskCount(body: string): number {
  return body.split("\n").filter((line) => OPEN_TASK.test(line)).length;
}

const NUMBER_WORDS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];

function matchCase(word: string, like: string): string {
  if (like === like.toUpperCase()) return word.toUpperCase();
  if (like[0] === like[0]!.toUpperCase()) return word[0]!.toUpperCase() + word.slice(1);
  return word;
}

/** The next title in a series: the first number (or number word up to
 * nineteen) goes up by one; a title without one gains " 2". */
export function nextInSeries(title: string): string {
  const digits = /\d+/.exec(title);
  const words = new RegExp(`\\b(${NUMBER_WORDS.slice(0, 19).join("|")})\\b`, "i").exec(title);
  if (digits && (!words || digits.index < words.index)) {
    const next = String(Number(digits[0]) + 1).padStart(digits[0].length, "0");
    return title.slice(0, digits.index) + next + title.slice(digits.index + digits[0].length);
  }
  if (words) {
    const at = NUMBER_WORDS.indexOf(words[1]!.toLowerCase());
    const next = matchCase(NUMBER_WORDS[at + 1]!, words[1]!);
    return title.slice(0, words.index) + next + title.slice(words.index + words[1]!.length);
  }
  return `${title.trim()} 2`;
}

/** The body a new list note starts with: its title, where it came from, and
 * a first empty task. */
export function nextListBody(nextTitle: string, previousTitle: string): string {
  return `# ${nextTitle}\n\nContinues [[${previousTitle}]].\n\n- [ ] \n`;
}
