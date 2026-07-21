export function missingTokens(text, tokens) {
  return tokens.filter((token) => !text.includes(token));
}

export function missingScriptSteps(scripts, requiredSteps) {
  const missing = [];
  for (const [script, steps] of Object.entries(requiredSteps)) {
    const command = scripts?.[script] ?? "";
    const commandSteps = command.split("&&").map((step) => step.trim());
    for (const step of steps) {
      if (!commandSteps.includes(step)) missing.push(`${script} -> ${step}`);
    }
  }
  return missing;
}
