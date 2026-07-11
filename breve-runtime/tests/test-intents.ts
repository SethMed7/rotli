#!/usr/bin/env bun
/**
 * Sequential conversation tests for the Signal routing layer.
 * Drives the SAME matchers the daemon uses (scripts/intents.ts) through scripted
 * conversations — including the exact exchanges that have failed for Seth — and
 * asserts where each message routes. Run: bun scripts/test-intents.ts
 */
import { normalizeAmPm, briefAsk, briefRegenMatch, bareFollowup, wantsLastAsText, topicBriefMatch, urlRequest, watchIntentMatch, schedulePairs, scheduleChangeGate, parseWhen, audioResearchAsk, inboxAsk, accountOf, inboxScope, mailSearchAsk, saveAttachmentIntent, folderFromCaption, slugifyTopic, stripStepNarration, modelDirective } from "../scripts/intents";

// Mirrors handle()'s ordering for the pure layers (flows with state are exercised live).
function route(text: string): string {
  if (wantsLastAsText(text)) return "as-text";
  const f = bareFollowup(text);
  if (f && f !== "text") return `followup:${f}`;
  if (text.trim().startsWith("/")) return `command:${text.trim().split(/\s+/)[0]}`;
  if (scheduleChangeGate(normalizeAmPm(text).toLowerCase(), schedulePairs(normalizeAmPm(text)).length)) return "schedule";
  if (/^\/remind\s+/i.test(text) || (/\bremind me\b/i.test(text) && parseWhen(normalizeAmPm(text)))) return "reminder";
  const ms = mailSearchAsk(text);
  if (ms) return `mailsearch:${ms.account ?? "default"}`;
  if (inboxAsk(text)) return `inbox:${inboxScope(text)}`;
  const rg = briefRegenMatch(text);
  if (rg) return `regen:${rg.meal ?? "default"}:${rg.model ?? "default"}`;
  const b = briefAsk(text);
  if (b) return `brief:${b.meal ?? "default"}:${b.format}`;
  if (audioResearchAsk(text, true)) return "audio-topic";
  if (watchIntentMatch(text)) return "watcher";
  const u = urlRequest(text);
  if (u) return `url:${u.mode}`;
  const tb = topicBriefMatch(text);
  if (tb) return `topic:${tb.deep ? "deep" : "quick"}`;
  return "chat";
}

const SCENARIOS: Array<[string, string, string]> = [
  // ── The June 12 morning incident, as it should now play out ──
  ["incident", "I got up early today. Can I have my morning brief?", "brief:morning:audio"],
  ["incident", "audio", "followup:audio"],
  ["incident", "as text", "as-text"],
  // ── Regenerate vs resend (June 22): "morning brief" RESENDS; a regen verb FORCES a fresh build ──
  ["regen", "can you regenerate me one with sonnet", "regen:default:sonnet"], // the verbatim June-22 case
  ["regen", "redo the morning brief", "regen:morning:default"],
  ["regen", "regenerate my brief with haiku", "regen:default:haiku"],
  ["regen", "regenerate the morning brief using gemini", "regen:morning:gemini"],
  ["regen", "can i have my morning brief", "brief:morning:audio"],   // no regen verb → resend, not regen
  ["regen", "redo that calculation", "chat"],                        // not a brief → never hijacked
  ["regen", "run it again", "chat"],                                 // anaphora w/o model → not a brief
  // ── June 12 afternoon incident (verbatim): must be AUDIO, never the picture ──
  ["incident2", "Give me the morning brief. I haven't seen it yet. Give me the audio morning brief. I will watch that then watch lunch.", "brief:morning:audio"],
  // ── June 12 SpaceX incident (verbatim transcript): a research question asking for an
  //    "audio brief response" must NOT be hijacked by daily-brief retrieval (it sent lunch) ──
  ["incident3", "What are your thoughts on the SpaceX IPO stock? I've heard people say get in and never bet against Elon But I've also heard people saying it's not worth getting into now because most likely it'll crash back down So to get in at the crash Can you review though is that accurate you can probably use deeper Reasoning for this specific project and get some research Then just give me an audio brief response of what you're thinking", "audio-topic"],
  ["incident3", "Give me an audio brief response on whether the chip selloff is overdone, do some research first", "audio-topic"],
  // ── Brief vocabulary ──
  ["briefs", "lunch brief", "brief:lunch:audio"],
  ["briefs", "can you give me the lunch brief", "brief:lunch:audio"],
  ["briefs", "nightcap", "brief:night:audio"],
  ["briefs", "my brief", "brief:default:audio"],
  ["briefs", "morning brief pdf", "brief:morning:pdf"],
  ["briefs", "show me the lunch brief", "brief:lunch:audio"], // "I never want a picture"
  ["briefs", "let me see the morning brief", "brief:morning:audio"],
  ["briefs", "let me listen to tonights brief", "brief:night:audio"],
  ["briefs", "the voice version", "followup:audio"],
  ["briefs", "pdf please", "followup:pdf"],
  // ── Topic vs daily ──
  ["topics", "give me a brief on SpaceX IPO", "topic:quick"],
  ["topics", "deep research brief on the chip selloff", "topic:deep"],
  ["topics", "email me the lunch brief", "chat"], // email flow owns it upstream of these layers
  // ── Schedule + travel-adjacent ──
  ["schedule", "Moving forward I want my morning briefs to be sent to me at 7 a.m.", "schedule"],
  ["schedule", "I would like my lunch ones at noon, my morning at 7 a.m., and my night at 6 p.m.", "schedule"],
  ["schedule", "what happened at 5 today?", "chat"],
  // ── Reminders ──
  ["remind", "remind me in 20m to flip the laundry", "reminder"],
  ["remind", "remind me tomorrow at 9 a.m. to call the bank", "reminder"],
  // ── Links + watchers ──
  ["links", "https://blog.cloudflare.com/frontier-model-defense/", "url:summary"],
  ["links", "read this to me https://example.com/post", "url:read"],
  ["links", "watch https://huggingface.co/MiniMaxAI and tell me when the M3 weights drop", "watcher"],
  // ── Inbox triage vs send-email flow — Seth's vocabulary (his definitions 2026-06-12) ──
  ["inbox", "anything in my inbox that matters?", "inbox:all"],
  ["inbox", "any new emails waiting for me", "inbox:all"],
  ["inbox", "check my work email", "inbox:msd"],            // work = MSD
  ["inbox", "anything in my MSD email?", "inbox:msd"],
  ["inbox", "check my company email", "inbox:proton"],      // company = proton
  ["inbox", "anything in my LLC email", "inbox:proton"],
  ["inbox", "my proton email — anything new?", "inbox:proton"],
  ["inbox", "anything new in my personal gmail?", "inbox:gmail"],
  ["inbox", "check my google email", "inbox:gmail"],
  ["inbox", "anything in my personal email?", "inbox:personal"], // proton+gmail, NOT work
  ["inbox", "check my email", "inbox:ask"],                 // bare "my email" → ask which
  ["inbox", "did I get any email today", "inbox:ask"],
  ["inbox", "search my work email for the TSYS contract", "mailsearch:msd"],
  ["inbox", "find that email about the Twilio invoice", "mailsearch:default"],
  ["inbox", "email me an update on Fable 5", "chat"], // send flow owns it (handled upstream)
  // ── Plain chat must stay chat ──
  ["chat", "what do you think about the new Apple frameworks?", "chat"],
  ["chat", "how are you?", "chat"],
  ["chat", "that movie was brief", "chat"],
  ["chat", "context please", "chat"],
];

let fail = 0;
for (const [group, text, want] of SCENARIOS) {
  const got = route(text);
  if (got !== want) { fail++; console.log(`FAIL [${group}] "${text}"\n  → ${got}, wanted ${want}`); }
}

// ── Saved-media capture (image/PDF filing) ───────────────────────────────────
let capChecks = 0;
const capFail = (m: string) => { fail++; console.log(`FAIL [capture] ${m}`); };
const eq = (label: string, got: unknown, want: unknown) => { capChecks++; if (got !== want) capFail(`${label} → ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };
const slugOf = (cap: string) => slugifyTopic(folderFromCaption(cap) || "");

// SECURITY: path-traversal / injection must NEVER survive slugify (the one user-derived path part)
eq(`slug("../../etc/passwd")`, slugifyTopic("../../etc/passwd"), "etc-passwd");
eq(`slug("/etc/shadow")`, slugifyTopic("/etc/shadow"), "etc-shadow");
eq(`slug("coffee/../../art")`, slugifyTopic("coffee/../../art"), "coffee-art");
eq(`slug("~/.ssh")`, slugifyTopic("~/.ssh"), "ssh");
eq(`slug("..")`, slugifyTopic(".."), null);
eq(`slug("....")`, slugifyTopic("...."), null);
eq(`slug("")`, slugifyTopic(""), null);
eq(`slug("   ")`, slugifyTopic("   "), null);
eq(`slug(80×a)`, slugifyTopic("a".repeat(80)), "a".repeat(40));
// normal topics
eq(`slug("coffee art")`, slugifyTopic("coffee art"), "coffee-art");
eq(`slug("Coffee Art!!")`, slugifyTopic("Coffee Art!!"), "coffee-art");
eq(`slug("House Ideas 2026")`, slugifyTopic("House Ideas 2026"), "house-ideas-2026");
// save-intent gate
eq(`intent(coffee folder)`, saveAttachmentIntent("save this in my coffee art folder"), true);
eq(`intent(verbatim 06-17)`, saveAttachmentIntent("can you save this fold in my storage in folder related to coffee art"), true);
eq(`intent("keep this photo")`, saveAttachmentIntent("keep this photo"), true);
eq(`intent("what is this?")`, saveAttachmentIntent("what is this?"), false);
eq(`intent("check out this latte")`, saveAttachmentIntent("check out this latte"), false);
// folder extraction → slug (regex fallback path; the verbatim 2026-06-17 caption)
eq(`folder(verbatim 06-17)`, slugOf("Can you caldo save this fold in my storage in folder related to coffee art"), "coffee-art");
eq(`folder("…my receipts folder")`, slugOf("save this to my receipts folder"), "receipts");
eq(`folder("put this in house ideas")`, slugOf("put this in house ideas"), "house-ideas");
eq(`folder("save it under travel 2026")`, slugOf("save it under travel 2026"), "travel-2026");
eq(`folder("what a nice photo")`, slugOf("what a nice photo"), null);

// ── Step-narration stripping (the 2026-06-15 Gemini chain-of-thought leak) ───
// Verbatim shape: a run of "I will list/view/edit…" sentences, then the real answer.
const LEAK = "I will start by listing the contents of the ~/breve directory. I will view the watchlist.md file to see how updates are managed. I will edit the watchlist to add both. Done. I've added Superintelligence to your watchlist under AI labs.";
eq(`strip(leak) recovers answer`, stripStepNarration(LEAK), "Done. I've added Superintelligence to your watchlist under AI labs.");
eq(`strip leaves clean answer alone`, stripStepNarration("Done. Added OpenCode to your watchlist."), "Done. Added OpenCode to your watchlist.");
eq(`strip keeps "I'll help…" opener`, stripStepNarration("I'll help you with that. Here's the rundown on Anthropic."), "I'll help you with that. Here's the rundown on Anthropic.");
eq(`strip keeps single "Let me check" opener`, stripStepNarration("Let me check the repo. The latest commit landed this morning and touches the gateway."), "Let me check the repo. The latest commit landed this morning and touches the gateway.");
eq(`strip preserves all-narration (no real answer)`, stripStepNarration("I will list the files. I will view the config."), "I will list the files. I will view the config.");

// ── Model directive (tightened) ──────────────────────────────────────────────
// A genuine IMPERATIVE pick honors the named tier; an incidental/hypothetical
// mention ("write me a sonnet", "go with sonnet later", "should I use opus?")
// must NOT hijack routing. "gemma"/"local" → local, "claude" → sonnet.
// POSITIVE — a clear imperative pick selects the tier:
eq(`md("use sonnet to analyze…")`, modelDirective("use sonnet to analyze this tradeoff"), "sonnet");
eq(`md("ask haiku what time…")`, modelDirective("ask haiku what time it is"), "haiku");
eq(`md("run this on gemini")`, modelDirective("run this on gemini"), "gemini");
eq(`md("use gemma") → local`, modelDirective("use gemma"), "local");
// bare leading "with" is NOT a directive verb in the tightened matcher (only use/ask/run/via/
// through, or run/use/… + on/with/via), so this is correctly null — too ambiguous to hijack:
eq(`md("with sonnet, summarize…")`, modelDirective("with sonnet, summarize this"), null);
// NEGATIVE — no imperative pick, so no directive (null):
eq(`md("write me a sonnet…")`, modelDirective("write me a sonnet about coffee"), null);
eq(`md("go with sonnet later")`, modelDirective("I'll probably go with sonnet later"), null);
eq(`md("should I use opus…?")`, modelDirective("should I use opus for this?"), null);
eq(`md("the sonnet brief was good")`, modelDirective("the sonnet brief was good"), null);
eq(`md("gemini said it was fine")`, modelDirective("gemini said it was fine"), null);

console.log(fail ? `${fail} FAILURES` : `all ${SCENARIOS.length} routing + ${capChecks} capture checks pass`);
process.exit(fail ? 1 : 0);
