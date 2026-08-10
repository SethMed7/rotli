export interface ResearchEvidenceRecord {
  sourceId: string;
  text: string;
}

/** Parse only the bounded fields the research tool supplied. Keeping this in
 * one policy module lets citation and semantic checks use the exact same source
 * namespace the model saw. */
export function researchEvidenceRecords(observation: string): ResearchEvidenceRecord[] {
  try {
    const value = JSON.parse(observation) as {
      kind?: unknown;
      evidenceAvailable?: unknown;
      sources?: unknown;
    };
    if (value.kind !== "web_research" || value.evidenceAvailable !== true || !Array.isArray(value.sources)) {
      return [];
    }
    return value.sources.flatMap((source) => {
      if (!source || typeof source !== "object") return [];
      const row = source as Record<string, unknown>;
      if (typeof row.sourceId !== "string" || !/^S[1-9]\d*$/.test(row.sourceId)) return [];
      const text = [row.title, row.searchExcerpt, row.evidence]
        .filter((field): field is string => typeof field === "string")
        .join("\n");
      return [{ sourceId: row.sourceId, text }];
    });
  } catch {
    return [];
  }
}

/** Deterministic citation policy for the local-model web lane. The model may
 * cite only identifiers supplied by a successful research observation. */
export function researchEvidenceSourceIds(observation: string): string[] {
  return researchEvidenceRecords(observation).map((source) => source.sourceId);
}

/** A model may refine its query and call research_web again in one turn. The
 * tool itself numbers each standalone package from S1, so the loop rewrites
 * later packages into one turn-global namespace before showing them to the
 * model. This keeps every citation unambiguous. */
export function renumberResearchEvidence(
  observation: string,
  firstNumber: number,
): { observation: string; sourceIds: string[]; nextNumber: number } {
  try {
    const value = JSON.parse(observation) as {
      kind?: unknown;
      evidenceAvailable?: unknown;
      sources?: unknown;
    };
    if (value.kind !== "web_research" || value.evidenceAvailable !== true || !Array.isArray(value.sources)) {
      return { observation, sourceIds: [], nextNumber: firstNumber };
    }
    const sourceIds: string[] = [];
    value.sources = value.sources.map((source) => {
      if (!source || typeof source !== "object") return source;
      const sourceId = `S${firstNumber + sourceIds.length}`;
      sourceIds.push(sourceId);
      return { ...source, sourceId };
    });
    return {
      observation: JSON.stringify(value),
      sourceIds,
      nextNumber: firstNumber + sourceIds.length,
    };
  } catch {
    return { observation, sourceIds: [], nextNumber: firstNumber };
  }
}

export function webCitationIssue(answer: string, validSourceIds: ReadonlySet<string>): string | null {
  if (validSourceIds.size === 0) return null;
  const grouped = answer.match(/\[(S\d+(?:\s*[,;]\s*S\d+)+)\]/i)?.[1];
  if (grouped) {
    const corrected = grouped
      .split(/\s*[,;]\s*/)
      .map((id) => `[${id.toUpperCase()}]`)
      .join("");
    return `Grouped citation [${grouped}] is ambiguous. Write each source separately as ${corrected}.`;
  }
  const cited = [...answer.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]!);
  if (cited.length === 0) {
    return "Web-grounded factual claims need citations such as [S1] from the supplied evidence.";
  }
  const invalid = cited.filter((sourceId) => !validSourceIds.has(sourceId));
  return invalid.length > 0
    ? `Unknown web source ${invalid[0]}. Cite only ${[...validSourceIds].map((id) => `[${id}]`).join(", ")}.`
    : null;
}

/** Gemma often groups otherwise-valid ids in one bracket. Normalize that
 * presentation-only mistake without spending another generation; semantic
 * validation still runs on the resulting individual citations. */
export function normalizeWebCitations(answer: string): string {
  return answer
    .replace(/\[(S\d+(?:\s*[,;]\s*S\d+)+)\]/gi, (_whole, group: string) =>
      group
        .split(/\s*[,;]\s*/)
        .map((id) => `[${id.toUpperCase()}]`)
        .join(""),
    )
    .replace(/\[s(\d+)\]/gi, "[S$1]");
}

const MONTH_NUMBER: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

interface TextSpan {
  start: number;
  end: number;
}

interface DateSpan extends TextSpan {
  month: number;
  day: number;
  year?: number;
  raw: string;
}

interface TimeSpan extends TextSpan {
  hour: number;
  minute: number;
  meridiem: "am" | "pm";
  zone?: string;
  raw: string;
}

interface TemporalPair {
  date: DateSpan;
  time: TimeSpan;
}

const DATE_PATTERN =
  /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
const TIME_PATTERN =
  /\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)(?:\s+((?:Eastern|Pacific)(?:\s+(?:Standard|Daylight))?\s+Time|[A-Z]{2,5}))?\b/gi;

function normalizedZone(zone: string): string {
  const words = zone.toLowerCase().replace(/\s+/g, " ").trim();
  if (words === "eastern time") return "ET";
  if (words === "pacific time") return "PT";
  if (words === "eastern standard time") return "EST";
  if (words === "pacific standard time") return "PST";
  if (words === "eastern daylight time") return "EDT";
  if (words === "pacific daylight time") return "PDT";
  return zone.toUpperCase();
}

function sameZone(claim?: string, evidence?: string): boolean {
  if (claim === undefined || evidence === undefined || claim === evidence) return true;
  if (claim === "ET") return evidence === "EST" || evidence === "EDT";
  if (claim === "PT") return evidence === "PST" || evidence === "PDT";
  if (evidence === "ET") return claim === "EST" || claim === "EDT";
  if (evidence === "PT") return claim === "PST" || claim === "PDT";
  return false;
}

function spansBetween(a: TextSpan, b: TextSpan): number {
  if (a.end < b.start) return b.start - a.end;
  if (b.end < a.start) return a.start - b.end;
  return 0;
}

/** Pair every clock time with its nearest written calendar date. This catches
 * the failure where a model independently copied a correct date and a correct
 * time-zone value, then joined them into a combination no source stated. */
function temporalPairs(text: string): TemporalPair[] {
  const dates: DateSpan[] = [...text.matchAll(DATE_PATTERN)].flatMap((match) => {
    const month = MONTH_NUMBER[match[1]!.toLowerCase()];
    const start = match.index;
    if (!month || start === undefined) return [];
    return [
      {
        start,
        end: start + match[0].length,
        month,
        day: Number(match[2]),
        ...(match[3] ? { year: Number(match[3]) } : {}),
        raw: match[0],
      },
    ];
  });
  const times: TimeSpan[] = [...text.matchAll(TIME_PATTERN)].flatMap((match) => {
    const start = match.index;
    if (start === undefined) return [];
    return [
      {
        start,
        end: start + match[0].length,
        hour: Number(match[1]),
        minute: Number(match[2]),
        meridiem: match[3]!.toLowerCase().startsWith("a") ? "am" : "pm",
        ...(match[4] ? { zone: normalizedZone(match[4]) } : {}),
        raw: match[0],
      },
    ];
  });
  return times.flatMap((time) => {
    const nearest = dates
      .map((date) => ({ date, distance: spansBetween(date, time) }))
      .filter(({ distance }) => distance <= 120)
      .sort((a, b) => a.distance - b.distance)[0]?.date;
    return nearest ? [{ date: nearest, time }] : [];
  });
}

function sameTemporalPair(claim: TemporalPair, evidence: TemporalPair): boolean {
  return (
    claim.date.month === evidence.date.month &&
    claim.date.day === evidence.date.day &&
    (claim.date.year === undefined ||
      evidence.date.year === undefined ||
      claim.date.year === evidence.date.year) &&
    claim.time.hour === evidence.time.hour &&
    claim.time.minute === evidence.time.minute &&
    claim.time.meridiem === evidence.time.meridiem &&
    sameZone(claim.time.zone, evidence.time.zone)
  );
}

/** Citation existence is necessary but not sufficient. For high-risk exact
 * anchors, verify the relationship too: a date and time/time-zone must occur as
 * the same pair in at least one cited source. This is deliberately narrow and
 * deterministic; it does not pretend to solve general textual entailment. */
export function webGroundingIssue(
  answer: string,
  evidenceBySource: ReadonlyMap<string, string>,
): string | null {
  if (evidenceBySource.size === 0) return null;
  const citationIssue = webCitationIssue(answer, new Set(evidenceBySource.keys()));
  const cited = [...answer.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]!);
  const sourcePairs = cited.flatMap((sourceId) =>
    temporalPairs(evidenceBySource.get(sourceId) ?? "").map((pair) => ({ sourceId, pair })),
  );
  const unsupported = temporalPairs(answer).find(
    (claim) => !sourcePairs.some(({ pair }) => sameTemporalPair(claim, pair)),
  );
  const temporalIssue = unsupported
    ? `The date/time pairing "${unsupported.date.raw} — ${unsupported.time.raw}" is not stated as one pair in the cited evidence. Preserve dates, clock times, and time zones together exactly as a source gives them.`
    : null;
  return [citationIssue, temporalIssue].filter(Boolean).join(" ") || null;
}
