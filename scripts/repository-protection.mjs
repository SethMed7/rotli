// Owner-operated, explicit application. Default is a read-only plan; --check compares GitHub to it read-only.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const repository = "SethMed7/rotli";
const mode = process.argv.slice(2);
if (mode.length > 1 || (mode[0] && !["--apply", "--check"].includes(mode[0])))
  throw new Error("Usage: bun run security:protect [--apply | --check]");
const plans = ["integrity", "owner-review", "owner-only-pushes", "all-branches", "tags"].map((name) =>
  JSON.parse(readFileSync(new URL(`../.github/rulesets/${name}.json`, import.meta.url), "utf8")),
);

// Every value the plan states must match; GitHub may add parameters the plan leaves at their defaults and
// returns rules in its own order.
function differs(plan, live, path = "") {
  if (Array.isArray(plan)) {
    const byType = plan.every((item) => item?.type);
    const want = byType ? [...plan].sort((a, b) => a.type.localeCompare(b.type)) : plan;
    const have = byType ? [...(live ?? [])].sort((a, b) => a.type.localeCompare(b.type)) : live;
    if (!Array.isArray(have) || have.length !== want.length)
      return `${path}: expected ${JSON.stringify(plan)}`;
    return want.map((item, index) => differs(item, have[index], `${path}[${index}]`)).find(Boolean);
  }
  if (plan && typeof plan === "object")
    return Object.keys(plan)
      .map((key) => differs(plan[key], live?.[key], `${path}.${key}`))
      .find(Boolean);
  return plan === live
    ? undefined
    : `${path}: expected ${JSON.stringify(plan)}, found ${JSON.stringify(live)}`;
}

if (!mode[0]) {
  console.log(JSON.stringify({ repository, apply: false, rulesets: plans }, null, 2));
} else {
  const gh = (args, input) => execFileSync("gh", args, { encoding: "utf8", ...(input ? { input } : {}) });
  if (gh(["api", "user", "--jq", ".login"]).trim() !== "SethMed7")
    throw new Error("Only the repository owner may apply or check this policy");
  // A 403 here stops before any mutation. Never change visibility to unlock rules.
  const existing = JSON.parse(gh(["api", `repos/${repository}/rulesets`]));
  const done = [];
  for (const plan of plans) {
    let id = existing.find((entry) => entry.name === plan.name)?.id;
    if (mode[0] === "--apply") {
      const endpoint = `repos/${repository}/rulesets${id ? `/${id}` : ""}`;
      id = JSON.parse(
        gh(["api", "--method", id ? "PUT" : "POST", endpoint, "--input", "-"], JSON.stringify(plan)),
      ).id;
    }
    const drift = id
      ? differs(plan, JSON.parse(gh(["api", `repos/${repository}/rulesets/${id}`])))
      : "missing on GitHub";
    if (drift)
      throw new Error(
        `${plan.name}: ${drift}${done.length ? ` (already verified: ${done.join(", ")})` : ""}`,
      );
    done.push(plan.name);
    console.log(`${plan.name}: matches the plan (id ${id})`);
  }
}
