export function missingTokens(text, tokens) {
  return tokens.filter((token) => !text.includes(token));
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
