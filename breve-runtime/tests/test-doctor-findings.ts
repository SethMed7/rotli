#!/usr/bin/env bun
import { findingFingerprints, newFindings } from "../scripts/doctor-findings";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const binary = "memex invariants failed:\n  binary in the memex: .rotli/breve/legacy-repo.bundle";
const disk = "Disk is low: 8GB free.";

assert(newFindings([binary], []).length === 1, "a first occurrence should notify");

const active = findingFingerprints([binary]);
assert(newFindings([binary], active).length === 0, "an unchanged finding should be suppressed");
assert(
  newFindings([`  ${binary.replace("\n  ", "\n      ")}  `], active).length === 0,
  "incidental whitespace should not create a new finding",
);

const onlyNovel = newFindings([binary, disk], active);
assert(onlyNovel.length === 1 && onlyNovel[0] === disk, "only a newly active finding should notify");

const resolved = findingFingerprints([]);
assert(resolved.length === 0, "a healthy run should clear the active set");
assert(newFindings([binary], resolved).length === 1, "a finding that returns after resolution should notify again");

console.log("doctor finding tests passed");
