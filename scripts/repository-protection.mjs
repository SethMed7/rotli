// Owner-operated, explicit application. Default is a read-only plan.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const repository = "SethMed7/rotli";
const arguments_ = process.argv.slice(2);
if (arguments_.some((value) => value !== "--apply"))
  throw new Error("Usage: bun run security:protect [--apply]");
const plans = ["integrity", "owner-review"].map((name) =>
  JSON.parse(readFileSync(new URL(`../.github/rulesets/${name}.json`, import.meta.url), "utf8")),
);
if (!arguments_.includes("--apply")) {
  console.log(JSON.stringify({ repository, apply: false, rulesets: plans }, null, 2));
} else {
  const gh = (args, input) => execFileSync("gh", args, { encoding: "utf8", ...(input ? { input } : {}) });
  if (gh(["api", "user", "--jq", ".login"]).trim() !== "SethMed7")
    throw new Error("Only the repository owner may apply this policy");
  // A 403 here stops before any mutation. Never change visibility to unlock rules.
  const existing = JSON.parse(gh(["api", `repos/${repository}/rulesets`]));
  for (const plan of plans) {
    const match = existing.find((entry) => entry.name === plan.name);
    const endpoint = `repos/${repository}/rulesets${match ? `/${match.id}` : ""}`;
    const applied = JSON.parse(
      gh(["api", "--method", match ? "PUT" : "POST", endpoint, "--input", "-"], JSON.stringify(plan)),
    );
    const verified = JSON.parse(gh(["api", `repos/${repository}/rulesets/${applied.id}`]));
    if (verified.enforcement !== "active") throw new Error(`${plan.name} is not enforced`);
    console.log(`${plan.name}: active (id ${applied.id})`);
  }
}
