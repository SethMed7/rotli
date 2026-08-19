/**
 * BREVE Signal intent matchers — pure functions, no IO, shared by the daemon and
 * scripts/test-intents.ts. Every routing regex lives HERE so the conversational
 * behavior is sequence-testable (the maintainer keeps finding edges by talking to it; tests
 * catch them before he does).
 */

/** Voice notes transcribe "7 a.m." with periods — normalize before any time parsing. */
export const normalizeAmPm = (text: string) => text.replace(/([ap])\.m\.?/gi, "$1m");

export type Meal = "morning" | "lunch" | "night";
export type BriefFormat = "audio" | "pdf" | "view" | "text";

export function mealOf(t: string): Meal | null {
  if (/\b(morning|breakfast|8\s?am)\b/.test(t)) return "morning";
  if (/\b(lunch(time)?|mid-?day|noon|pivot)\b/.test(t)) return "lunch";
  if (/\b(night(time)?|tonight'?s?|evening|nightcap|archive)\b/.test(t)) return "night";
  return null;
}

/**
 * "Cover this in tomorrow's brief" / "keep an eye on this topic" — a QUEUE/WATCH
 * instruction, not a request to send a brief. Routes to inbox.md (→ next brief +
 * watchlist). Catches the case that used to be hijacked into retrieval because it
 * mentioned "morning brief".
 */
export function briefQueueMatch(text: string): { note: string; url: string | null } | null {
  const t = text.toLowerCase();
  const queueVerb =
    /\b(talk about|talk to me about|mention|cover|include|add|put|note|jot|bring up|touch on|feature|discuss|write about|report on|keep covering)\b/;
  const briefWord = /\b(brief|briefs|briefing|pivot|nightcap|newsletter)\b/;
  const futureWord =
    /\b(tomorrow|tomorrows|tomorrow'?s|next|upcoming|future|going forward|each|every|daily|coming|the morning|over the next)\b/;
  const keepWatch =
    /\b(keep an eye on|keep watching|keep tracking|keep me (posted|updated|in the loop)|stay on top of|follow (this|that|it|the)|track (this|that|it|the)|monitor (this|that|it|the))\b/;
  const forDays = /\bfor (the )?(next |coming |several |few )*(day|days|week|weeks)\b/;
  const coverInBrief = queueVerb.test(t) && briefWord.test(t) && futureWord.test(t);
  const ongoingWatch = keepWatch.test(t) || forDays.test(t);
  if (!coverInBrief && !ongoingWatch) return null;
  const url = text.match(/https?:\/\/\S+/)?.[0]?.replace(/[).,!?]+$/, "") ?? null;
  const note = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:]+/, "")
    .trim();
  return { note: note || "(see linked topic)", url };
}

/** Daily-brief retrieval ask. null = not a retrieval (topic asks, email asks, chatter). */
export function briefAsk(text: string): { meal: Meal | null; format: BriefFormat; date?: string } | null {
  // "talk about X in tomorrow's brief" / "keep an eye on this" is a queue instruction,
  // not "send me the brief" — let handleBriefQueue own it.
  if (briefQueueMatch(text)) return null;
  const t = text.toLowerCase();
  if (!/\b(brief|pivot|nightcap)\b/.test(t)) return null;
  if (/\bbrief(ing)?\s+(me\s+)?(on|about)\b/.test(t)) return null; // topic brief
  if (/\bemail\b/.test(t)) return null; // email flow owns those
  // "give me an audio brief RESPONSE" = answer-format request, not the daily drop
  if (/\bbrief\s+(response|answer|reply|version|summary)\b/.test(t)) return null;
  // a long message mentioning "brief" with no meal word is a content ask, not retrieval
  if (!mealOf(t) && t.length > 110) return null;
  const questiony = /\b(what|why|how|did|does|was|were|when|who|say|said|wrong|mistake|missing)\b/.test(t);
  const wantsIt =
    /^\s*(can i (have|get) )?(the |my |an |a )?((audio|voice|spoken|morning|breakfast|daily|today'?s?|latest|lunch(time)?|mid-?day|noon|night(time)?|evening|tonight'?s?) )*(brief|pivot|nightcap)( please| pls)?( pdf| audio| view| text| file)?\s*[?.!]*\s*$/.test(
      t,
    ) ||
    /\b(send|give|get|share|forward|resend|show|attach|grab|pull up|have)\b.*\b(brief|pivot|nightcap)\b/.test(
      t,
    ) ||
    /\b(play|listen( to)?|hear|read)\b.*\b(brief|pivot|nightcap)\b/.test(t) ||
    /\b(audio|voice|spoken)\b.*\bbrief\b/.test(t) ||
    /\bbrief\b.*\b(audio|voice|out loud)\b/.test(t) ||
    /\b(today'?s?|this morning'?s?|the morning|latest|daily|lunch|mid-?day|tonight'?s?|night|evening)\b.*\bbrief\b/.test(
      t,
    ) ||
    // meal word + brief word anywhere, as long as it's a request, not a question about content
    (!questiony &&
      /\b(morning|breakfast|lunch(time)?|mid-?day|noon|night(time)?|evening|tonight'?s?)\b.*\b(brief|pivot|nightcap)\b/.test(
        t,
      ));
  if (!wantsIt) return null;
  // the maintainer: "I never want a picture" — view exists ONLY via the explicit /brief view command.
  const format: BriefFormat = /\b(pdf|file|document)\b/.test(t)
    ? "pdf"
    : /\btext\b/.test(t)
      ? "text"
      : "audio";
  return { meal: mealOf(t), format, date: text.match(/\d{4}-\d{2}-\d{2}/)?.[0] };
}

/** "regenerate / redo / remake my (morning) brief [with <model>]" → force a FRESH brief even when
 *  today's already exists (unlike briefAsk, which only RESENDS). Returns the meal + requested model
 *  (a tier name), or null. Gated tightly so it never hijacks a non-brief "redo" ("redo that file"). */
export function briefRegenMatch(text: string): { meal: Meal | null; model: ModelTier | null } | null {
  const t = text.toLowerCase();
  if (/\bemail\b/.test(t)) return null;
  const regenVerb =
    /\b(re-?generate|re-?gen|re-?do|re-?make|re-?run|re-?build|re-?create|re-?write)\b/.test(t) ||
    /\b(generate|make|do|build|run|create|give me|send me)\b[^.!?]*\b(again|another|a (?:new|fresh) one|fresh)\b/.test(
      t,
    );
  if (!regenVerb) return null;
  const briefWord = /\b(brief|pivot|nightcap|newsletter)\b/.test(t);
  const mm = t.match(
    /\b(?:with|using|use|on|in|via|through|as)\s+(?:the\s+)?(gemini|gemma|local|haiku|sonnet|opus|fable|claude)\b/,
  );
  // anaphora ("one/it/another/that") only counts as a brief reference when a model is ALSO named —
  // so "regenerate me one with sonnet" matches, but "redo that file" / "run it again" never do.
  const anaphora = /\b(one|it|another|that)\b/.test(t);
  if (!briefWord && !(anaphora && mm)) return null;
  let model: ModelTier | null = null;
  if (mm) {
    const k = mm[1];
    model = k === "gemma" || k === "local" ? "local" : k === "claude" ? "sonnet" : (k as ModelTier);
  }
  return { meal: mealOf(t), model };
}

/** One-or-two-word follow-ups ("audio", "pdf please", "the voice version"). */
export function bareFollowup(text: string): BriefFormat | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[?.!]+$/, "");
  if (
    /^(the |my |as |in )?(audio|voice|spoken)( version| one| please| pls)?$/.test(t) ||
    /^(out loud|say it|speak it|listen)$/.test(t)
  )
    return "audio";
  if (/^(the |my |as |a )?(pdf|file)( version| one| please| pls)?$/.test(t)) return "pdf";
  if (/^(the |as |in )?(text|words|written)( version| one| please| pls)?$/.test(t)) return "text";
  return null;
}

export function wantsLastAsText(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /^(show|send|give( me)?|see|put)?\s*(me\s+)?(that|it|the (last|answer|reply))?\s*(as|in)\s+text\s*[?.!]*$/.test(
      t,
    ) || /^(text|written)( version| please| pls)?\s*[?.!]*$/.test(t)
  );
}

export function topicBriefMatch(text: string): { topic: string; deep: boolean } | null {
  const m = text.match(/\bbrief(?:ing)?\s+(?:me\s+)?(?:on|about)\s+(.{3,})/i);
  if (!m) return null;
  return {
    topic: m[1].replace(/[?.!]+$/, "").trim(),
    deep: /\b(deep(er)?|detailed|thorough|in depth|full|research)\b/i.test(text),
  };
}

export function urlRequest(text: string): { mode: "summary" | "read"; url: string } | null {
  const url = text.match(/https?:\/\/\S+/)?.[0]?.replace(/[).,!?]+$/, "");
  if (!url) return null;
  const t = text.toLowerCase();
  if (/\b(read|play|listen|out loud|hear)\b/.test(t)) return { mode: "read", url };
  if (/\b(summar|tl;?dr|recap|gist|digest|what('s| is) (this|it)|key points)\b/.test(t))
    return { mode: "summary", url };
  const rest = text.replace(/https?:\/\/\S+/g, "").replace(/[^a-z]/gi, "");
  return rest.length <= 12 ? { mode: "summary", url } : null;
}

export function watchIntentMatch(text: string): { url: string; condition: string | null } | null {
  const url = text.match(/https?:\/\/\S+/)?.[0]?.replace(/[).,!?]+$/, "");
  if (!url) return null;
  const t = text.toLowerCase();
  if (!/\bwatch\b/.test(t) && !/\b(tell|let) me (know )?(when|if)\b/.test(t)) return null;
  const condition =
    text
      .replace(/https?:\/\/\S+/g, "")
      .replace(
        /\b(can you|please|watch|this page|this|and|keep an eye on|tell me (know )?(when|if)|let me (know )?(when|if))\b/gi,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim() || null;
  return { url, condition };
}

/** Explicit model choice — "use/ask/run/via/through <model>" as a CONFIDENT imperative pick,
 *  not casual chatter ("write me a sonnet", "I'll go with sonnet later", "gemini said it was
 *  fine"). Honors what the maintainer says: if he genuinely commands a model, that tier runs (no
 *  auto-routing). Returns the tier token, or null if ambiguous — the smart router (and the
 *  daemon's paid-tier gate) handle the rest. "claude" → sonnet; "gemma" → local. */
export type ModelTier = "gemini" | "local" | "haiku" | "sonnet" | "opus" | "fable";
export function modelDirective(text: string): ModelTier | null {
  const t = text.toLowerCase();
  const MODEL = "(gemini|gemma|local|haiku|sonnet|opus|fable|claude)";
  // Negative guards — tentative/past/deferred picks, or the model word as a noun/citation.
  if (new RegExp(`\\b(an?|the)\\s+${MODEL}s?\\b`).test(t)) return null; // "a sonnet", "the sonnet brief"
  if (new RegExp(`\\b${MODEL}s\\b`).test(t)) return null; // plural noun ("sonnets")
  if (new RegExp(`\\b${MODEL}\\s+(said|says|thinks?|thought|told|wrote)\\b`).test(t)) return null; // citation
  if (
    /\b(went with|going to (go|use)|gonna|maybe|probably|might|may|i'?d|should i|could i|would|later|eventually|some ?day|next time|for now)\b/.test(
      t,
    )
  )
    return null;
  // Confident pick: a directive verb tightly bound to the model, at the start or right after a
  // request verb. "with/on" only count when a directive verb leads ("run this on gemini").
  const pickVerb = "(?:use|using|ask|run|via|through)";
  const lead = new RegExp(
    `^\\s*(?:please\\s+)?(?:can you\\s+|could you\\s+)?${pickVerb}\\s+(?:the\\s+)?${MODEL}\\b`,
  );
  const anywhere = new RegExp(`\\b${pickVerb}\\s+(?:the\\s+)?${MODEL}\\b`);
  const onVia = new RegExp(
    `\\b(?:run|use|ask|do|send|put)\\b[^.!?]*?\\b(?:on|with|via|through)\\s+(?:the\\s+)?${MODEL}\\b`,
  );
  const m = t.match(lead) ?? t.match(anywhere) ?? t.match(onVia);
  if (!m) return null;
  const k = m[1];
  if (k === "gemma" || k === "local") return "local";
  if (k === "claude") return "sonnet";
  return k as ModelTier;
}

// ── Saved-media (image/PDF) capture ──────────────────────────────────────────
/** Does this caption ask Breve to KEEP the attachment (save/file/store it), vs just share it?
 *  Needs a save verb AND an object it plausibly refers to — so "save this to coffee art" fires
 *  but "what is this?" does not. Used as a fast gate + as the fallback when local Gemma is down. */
export function saveAttachmentIntent(caption: string): boolean {
  const t = (caption ?? "").toLowerCase();
  if (!/\b(save|keep|store|file|stash|archive|put|stick|add|drop|hold on ?to|hang on ?to)\b/.test(t))
    return false;
  return /\b(this|it|that|these|them|image|images|photo|photos|pic|pics|picture|pictures|file|files|attachment|shot|screenshot|folder|storage)\b/.test(
    t,
  );
}

/** Pull the folder/topic phrase out of a caption ("…in a folder related to coffee art" → "coffee art").
 *  Regex fallback for when local Gemma can't classify; always re-sanitized by slugifyTopic. */
export function folderFromCaption(caption: string): string | null {
  const t = (caption ?? "").toLowerCase();
  const strip = (s: string) =>
    s
      .replace(/\bfold(?:er|ers)?\b/g, " ")
      .replace(
        /\b(my|the|a|an|in|to|into|under|named|called|please|pls|thanks?|thx|storage|smstorage)\b/g,
        " ",
      )
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  // "folder related to|for|about|called|named|: X" — the explicit-folder phrasing
  let m = t.match(/\bfold(?:er)?\s+(?:related to|for|about|called|named|labeled|on|of|:)\s+(.+)/);
  if (m) return strip(m[1]) || null;
  // "in/to/under (my|the) X folder"
  m = t.match(/\b(?:in|to|into|under)\s+(?:my|the|a)?\s*([a-z0-9 ]+?)\s+fold(?:er)?\b/);
  if (m) return strip(m[1]) || null;
  // "save this (in|to|under|as) X" (X is whatever trails)
  m = t.match(
    /\b(?:save|keep|store|file|put|stash)\b[^a-z0-9]*(?:this|it|that|the (?:image|photo|pic|picture|file|shot|screenshot))?\s*(?:in|to|into|under|as)\s+(.+)/,
  );
  if (m) return strip(m[1]) || null;
  return null;
}

/** Sanitize ANY topic string into a safe folder slug. SECURITY-CRITICAL: the only path component
 *  Breve derives from user input. Forces [a-z0-9-] (so "../", "/", ".", spaces, unicode all collapse
 *  to dashes), caps length, and rejects anything that doesn't end up a clean non-empty slug. */
export function slugifyTopic(raw: string): string | null {
  const slug = (raw ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // drop accents
    .replace(/[^a-z0-9]+/g, "-") // EVERYTHING else → dash (kills / \ .. spaces)
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40)
    .replace(/-+$/g, ""); // re-trim after the slice
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug) ? slug : null;
}

/** Strip leading tool/step narration a model sometimes leaks despite the "answer only" rule
 *  ("I will list the files. I will view the config… Done — added X."). CONSERVATIVE by design:
 *  removes only a RUN of ≥2 leading sentences that clearly narrate a TOOL STEP (a step verb like
 *  list/view/check/run), and only if a substantive answer remains — so a normal "I'll help…" opener
 *  or a one-line "Let me check…" is left untouched. Pure + testable; applied to the Gemini tier. */
const STEP_RE =
  /^(?:i(?:'|\s+wi)?ll|i\s+am\s+going\s+to|i'?m\s+going\s+to|let\s+me|now\s+(?:i'?ll|i\s+will|let\s+me)|first,?\s+i)\b[^.!?]*\b(?:start|begin|list|view|read|open|check|look|search|find|run|execute|inspect|examine|update|edit|modify|create|fetch|grep|scan|navigate|explore|gather|analy[sz]e|review|see|verify|confirm|locate|understand)\b/i;
export function stripStepNarration(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  let i = 0;
  while (i < sentences.length && STEP_RE.test(sentences[i].trim())) i++;
  if (i < 2) return text; // need a real RUN of step narration, not one opener
  const rest = sentences.slice(i).join(" ").trim();
  return rest.length >= 40 ? rest : text; // if stripping leaves nothing substantive, keep original
}

/** Which mailbox is meant. Maps spoken vocabulary → account key. Account keys
 *  (proton/gmail/msd) are defined per-install in mail-accounts.json; the words
 *  here are generic (no personal emails in the repo — say the keyword, not the
 *  address). Add per-account aliases in mail-accounts.json if you want more.
 *    "work" / "MSD" / "merchant service"  → msd
 *    "company" / "LLC" / "proton"         → proton
 *    "gmail" / "google"                   → gmail
 *    "personal" alone                     → personal group (proton + gmail, NOT work)
 *    no hint                              → null (caller decides: all, or ask)
 */
export type MailScope = "proton" | "gmail" | "msd" | "personal" | null;
export function accountOf(text: string): MailScope {
  const t = text.toLowerCase();
  if (/\b(work|msd|merchant\s?service)\b/.test(t)) return "msd";
  if (/\b(gmail|google\s?(mail|inbox|e-?mail)?)\b/.test(t)) return "gmail";
  if (/\b(proton|company|llc)\b/.test(t)) return "proton";
  if (/\bpersonal\b/.test(t)) return "personal"; // proton + gmail, excludes work
  return null;
}

/** How to scope an inbox ask: a named account, "personal" group, "all", or ASK the maintainer.
 *  Rule (his): bare "my email" with no account hint → ask which one;
 *  plural/collective words ("inbox", "emails", "all", "everything") → all, no ask. */
export function inboxScope(text: string): MailScope | "all" | "ask" {
  const acc = accountOf(text);
  if (acc) return acc;
  const t = text.toLowerCase();
  if (/\b(all|every(thing)?|inbox(es)?|e-?mails|mailboxes)\b/.test(t)) return "all";
  return "ask";
}

/** "Anything in my inbox?" / "check my work email" — read-only triage, NOT the send-email flow. */
export function inboxAsk(text: string): boolean {
  const t = text.toLowerCase();
  if (!/\b(inbox(es)?|e-?mails?|gmail|proton)\b/.test(t)) return false;
  if (/\be-?mail (me|myself|it|that|this)\b/.test(t)) return false; // "email me X" = send flow
  return (
    /^\/inbox\b/.test(t.trim()) ||
    /\b(check|checked|anything|any|what'?s|new|unread|important|matter|waiting|look at|triage|catch up)\b/.test(
      t,
    )
  );
}

/** "search my work email for the TSYS contract" → {account, query}. */
export function mailSearchAsk(text: string): { account: string | null; query: string } | null {
  const m = text.match(
    /\b(?:search|find|look)(?:\s+\w+){0,4}?\s+(?:e-?mails?|inbox(?:es)?|mail)\b.*?\b(?:for|about)\s+(.{3,})/i,
  );
  if (!m) return null;
  return { account: accountOf(text), query: m[1].replace(/[?.!]+$/, "").trim() };
}

/** "Research X and give me an audio brief response" → the researched audio-topic
 *  pipeline (Sonnet digs, Kokoro speaks), not a daily drop and not a text reply. */
export function audioResearchAsk(text: string, asVoice = false): boolean {
  const t = text.toLowerCase();
  if (t.length < 80) return false;
  const wantsAudio =
    /\b(audio|spoken|voice)\s+(brief|response|answer|version|summary)\b/.test(t) ||
    /\bbrief\s+(response|answer)\b/.test(t) ||
    (asVoice && /\baudio\b/.test(t));
  const researchy =
    /\b(deep(er)?|research|look into|review|analy[sz]|reasoning|investigate|dig into|thoughts on)\b/.test(t);
  return wantsAudio && researchy;
}

export function parseClock(s: string): number | null {
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2] ? parseInt(m[2]) : 0;
  if (m[3]?.toLowerCase() === "pm" && h < 12) h += 12;
  if (m[3]?.toLowerCase() === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "(meal … at|by time)" pairs for schedule changes. Text should be normalizeAmPm'd. */
export function schedulePairs(text: string): Array<[Meal, number]> {
  const pairs: Array<[Meal, number]> = [];
  const re =
    /\b(morning|breakfast|lunch(?:time)?|midday|noon brief|night(?:time)?|dinner|evening|nightcap)\b[^,;.]*?\b(?:at|by)\s+(noon|midnight|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/gi;
  let m;
  while ((m = re.exec(text))) {
    const meal: Meal = /lunch|midday/i.test(m[1])
      ? "lunch"
      : /night|dinner|evening/i.test(m[1])
        ? "night"
        : "morning";
    const mins =
      m[2].toLowerCase() === "noon" ? 720 : m[2].toLowerCase() === "midnight" ? 0 : parseClock(m[2]);
    if (mins !== null) pairs.push([meal, mins]);
  }
  return pairs;
}

export function scheduleChangeGate(t: string, pairCount = 0): boolean {
  if (!/\b(at|by)\s+\d|at\s+(noon|midnight)/.test(t)) return false;
  if (!/\b(moving forward|from now on|going forward|change|set|want|schedule|send|like)\b/.test(t))
    return false;
  // "morning briefs at 7am" — or, without the word "brief", two+ meal/time pairs
  // ("lunch ones at noon, morning at 7am, night at 6pm") is unambiguous.
  return /\b(brief|pivot|nightcap)s?\b/.test(t) || pairCount >= 2;
}

export function parseWhen(t: string, now = new Date()): { due: number; rest: string } | null {
  let m = t.match(
    /\bin\s+(\d+(?:\.\d+)?)\s*(m(?:in(?:ute)?s?)?|h(?:(?:ou)?rs?)?|d(?:ays?)?|s(?:ec(?:ond)?s?)?)\b/i,
  );
  if (m) {
    const n = parseFloat(m[1]);
    const unit = m[2][0].toLowerCase();
    const ms = unit === "s" ? n * 1e3 : unit === "m" ? n * 6e4 : unit === "h" ? n * 36e5 : n * 864e5;
    return { due: now.getTime() + ms, rest: t.replace(m[0], "") };
  }
  m = t.match(
    /\b(tomorrow|tonight|today)?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b(?!\s*(m|h|d|min|hour|day))/i,
  );
  if (m && (m[1] || m[4] || m[3])) {
    let h = parseInt(m[2]);
    const min = m[3] ? parseInt(m[3]) : 0;
    if (m[4]?.toLowerCase() === "pm" && h < 12) h += 12;
    if (m[4]?.toLowerCase() === "am" && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, min, 0, 0);
    if (/tomorrow/i.test(m[1] ?? "")) d.setDate(d.getDate() + 1);
    else if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return { due: d.getTime(), rest: t.replace(m[0], "") };
  }
  m = t.match(/\btomorrow morning\b/i);
  if (m) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return { due: d.getTime(), rest: t.replace(m[0], "") };
  }
  return null;
}
