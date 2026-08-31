export function missingTokens(text, tokens) {
  return tokens.filter((token) => !text.includes(token));
}

/**
 * Names that no runner mentions. `haystack` is the concatenated text of every
 * place a name could legitimately be invoked from (package scripts, workflows,
 * sibling scripts); `exemptions` maps a name to the reason it is deliberately
 * never run. An unexempt name that appears nowhere is the silent third state:
 * a file that exists, looks maintained, and executes never.
 */
export function unreferencedNames(names, haystack, exemptions = {}) {
  return names.filter((name) => !(name in exemptions) && !haystack.includes(name));
}

export function missingScriptSteps(scripts, requiredSteps) {
  const missing = [];
  for (const [script, steps] of Object.entries(requiredSteps)) {
    const command = scripts?.[script] ?? "";
    const commandSteps = command.split("&&").map((step) => step.trim());
    for (const step of steps) {
      const parallelSteps = commandSteps.flatMap((commandStep) => {
        const match = commandStep.match(/^bun run --parallel\s+(.+)$/);
        return match ? match[1].trim().split(/\s+/).map((name) => `bun run ${name}`) : [];
      });
      if (!commandSteps.includes(step) && !parallelSteps.includes(step)) {
        missing.push(`${script} -> ${step}`);
      }
    }
  }
  return missing;
}
