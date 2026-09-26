import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("every Breve IPC command refuses before any body work in a disabled build", () => {
  let commands = 0;
  for (const path of ["src-tauri/src/breve.rs", "src-tauri/src/breve_pdf.rs"]) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(
      /#\[tauri::command\]\s+pub (?:async )?fn (\w+)\([\s\S]*?\) -> Result<[^\n]+\{\s*([^\n]+)/g,
    )) {
      expect(match[2]?.trim()).toBe("crate::feature_policy::require_breve()?;");
      commands++;
    }
  }
  expect(commands).toBe(16);
});

test("main and dev keep mandatory CI without any bypass; only the owner role can bypass self-review through a PR", () => {
  const integrity = JSON.parse(readFileSync(".github/rulesets/integrity.json", "utf8"));
  const review = JSON.parse(readFileSync(".github/rulesets/owner-review.json", "utf8"));
  for (const policy of [integrity, review]) {
    expect(policy.enforcement).toBe("active");
    expect(policy.conditions.ref_name.include).toEqual(["refs/heads/main", "refs/heads/dev"]);
  }
  expect(integrity.bypass_actors).toEqual([]);
  expect(integrity.rules.map((rule: { type: string }) => rule.type)).toContain("required_status_checks");
  expect(review.bypass_actors).toEqual([
    { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" },
  ]);
  expect(review.rules[0].parameters.require_code_owner_review).toBe(true);
  expect(review.rules[0].parameters.dismiss_stale_reviews_on_push).toBe(true);
});

test("only the owner role can delete or rewrite any branch or tag, and Dependabot keeps its own branches", () => {
  const owner = [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }];
  const read = (name: string) => JSON.parse(readFileSync(`.github/rulesets/${name}.json`, "utf8"));
  const branches = read("all-branches");
  const tags = read("tags");
  const pushes = read("owner-only-pushes");
  for (const policy of [branches, tags, pushes]) {
    expect(policy.enforcement).toBe("active");
    expect(policy.bypass_actors).toEqual(owner);
  }
  expect(branches.conditions.ref_name).toEqual({ include: ["~ALL"], exclude: ["refs/heads/dependabot/**"] });
  expect(branches.rules.map((rule: { type: string }) => rule.type)).toEqual(["deletion", "non_fast_forward"]);
  expect(tags.target).toBe("tag");
  expect(tags.conditions.ref_name.include).toEqual(["~ALL"]);
  expect(tags.rules.map((rule: { type: string }) => rule.type)).toEqual([
    "deletion",
    "update",
    "non_fast_forward",
  ]);
  expect(pushes.conditions.ref_name.include).toEqual(
    expect.arrayContaining(["refs/heads/main", "refs/heads/dev"]),
  );
});
