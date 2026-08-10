import { describe, expect, test } from "bun:test";

import {
  renumberResearchEvidence,
  researchEvidenceRecords,
  researchEvidenceSourceIds,
  normalizeWebCitations,
  webCitationIssue,
  webGroundingIssue,
} from "./webEvidence";

describe("local web evidence citations", () => {
  test("accepts only source identifiers present in a successful research observation", () => {
    const observation = JSON.stringify({
      kind: "web_research",
      evidenceAvailable: true,
      sources: [{ sourceId: "S1" }, { sourceId: "S2" }, { sourceId: "source-3" }, { sourceId: "S0" }],
    });
    expect(researchEvidenceSourceIds(observation)).toEqual(["S1", "S2"]);
    expect(researchEvidenceSourceIds("not JSON")).toEqual([]);
    expect(
      researchEvidenceSourceIds(
        JSON.stringify({ kind: "web_research", evidenceAvailable: false, sources: [{ sourceId: "S1" }] }),
      ),
    ).toEqual([]);
  });

  test("requires a supplied citation and rejects invented identifiers", () => {
    const valid = new Set(["S1", "S2"]);
    expect(webCitationIssue("The documented fact. [S1]", valid)).toBeNull();
    expect(webCitationIssue("The documented fact.", valid)).toMatch(/need citations/i);
    expect(webCitationIssue("The documented fact. [S9]", valid)).toMatch(/unknown web source S9/i);
    expect(webCitationIssue("An honest abstention.", new Set())).toBeNull();
    expect(webCitationIssue("Two sources agree. [S1, S2]", valid)).toMatch(/grouped citation/i);
  });

  test("normalizes grouped citations without changing surrounding prose", () => {
    expect(normalizeWebCitations("Claim. [S1, S2]; another [S3].")).toBe("Claim. [S1][S2]; another [S3].");
    expect(normalizeWebCitations("Claim. [s1].")).toBe("Claim. [S1].");
  });

  test("retains bounded evidence text beside each valid source id", () => {
    const records = researchEvidenceRecords(
      JSON.stringify({
        kind: "web_research",
        evidenceAvailable: true,
        sources: [
          { sourceId: "S1", title: "NASA", searchExcerpt: "Falcon 9", evidence: "November 24" },
          { sourceId: "bad", evidence: "ignored" },
        ],
      }),
    );
    expect(records).toEqual([{ sourceId: "S1", text: "NASA\nFalcon 9\nNovember 24" }]);
  });

  test("rejects a date/time-zone pairing assembled incorrectly across evidence", () => {
    const evidence = new Map([
      ["S1", "NASA reports November 24, 2021 at 1:21 a.m. EST on a SpaceX Falcon 9."],
      ["S2", "SpaceX reports November 23, 2021 at 10:21 p.m. PST on a Falcon 9."],
    ]);
    expect(webGroundingIssue("DART launched November 23, 2021 at 1:21 a.m. EST. [S1][S2]", evidence)).toMatch(
      /date\/time pairing/i,
    );
    expect(
      webGroundingIssue(
        "DART launched on Falcon 9 at 10:21 p.m. PST on November 23, 2021 [S2], which was 1:21 a.m. EST on November 24, 2021 [S1].",
        evidence,
      ),
    ).toBeNull();
    expect(webGroundingIssue("DART launched November 23, 2021 at 1:21 a.m. est. [S1][S2]", evidence)).toMatch(
      /date\/time pairing/i,
    );
    expect(
      webGroundingIssue(
        "DART launched at 10:21 p.m. Pacific Time on November 23, 2021 [S2], which was 1:21 a.m. Eastern Time on November 24, 2021 [S1].",
        evidence,
      ),
    ).toBeNull();
    expect(
      webGroundingIssue("DART launched November 24, 2021 at 1:21 a.m. Pacific Time. [S1]", evidence),
    ).toMatch(/date\/time pairing/i);
  });

  test("renumbers later research packages into one turn-global source namespace", () => {
    const raw = JSON.stringify({
      kind: "web_research",
      evidenceAvailable: true,
      sources: [
        { sourceId: "S1", title: "Two" },
        { sourceId: "S2", title: "Three" },
      ],
    });
    const numbered = renumberResearchEvidence(raw, 4);
    expect(numbered.sourceIds).toEqual(["S4", "S5"]);
    expect(numbered.nextNumber).toBe(6);
    expect(researchEvidenceSourceIds(numbered.observation)).toEqual(["S4", "S5"]);
  });
});
