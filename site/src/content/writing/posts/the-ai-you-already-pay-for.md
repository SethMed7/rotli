---
title: Paid AI plans often sit unopened. rotli can put them to work.
description: What recent surveys say about paid AI plans that go unused, what they can't say, and how rotli's Librarian files your notes with the plan or tool you already have, or a model on your Mac.
section: post
tags: [AI, Research, Librarian]
date: 2026-10-05
---

We can't tell you how much of your AI plan goes unused. No survey we found measures that. What surveys
can tell us is how many people pay for an AI tool and then haven't opened it lately. That number is
large enough to matter. It is why rotli doesn't sell an AI plan of its own, and puts the one you
already have to work instead. This post sets out the numbers, who was asked, and what they leave out.

## What the numbers say

**Many paying users hadn't opened their plan in a month.** In March 2026, Self Financial surveyed 1,272
U.S. adults who pay for at least one subscription of any kind. It asked about ten paid AI services. Among
respondents who had each one, the share who hadn't used it in the past 30 days was:

- **ChatGPT:** 50.4%, the highest of the ten
- **Midjourney:** 42.6%
- **Canva AI:** 40.2%
- **Gemini:** 35.3%
- **Claude:** 27.2%, the lowest of the ten

The other five (Grammarly AI, Jasper AI, Notion AI, Writesonic, and Perplexity) fell between 35.8% and
38.7%. Every tool in the survey had at least a quarter of its paying users unused for the month.

```figure
kind: bar
title: Paying users who hadn't used the tool in the past 30 days
caption: Five of the ten paid AI services in the survey, each among the respondents who had it. Self Financial surveyed 1,272 U.S. adults who pay for at least one subscription, in March 2026.
source: Self Financial, “The Cost of Unused Paid Subscriptions 2026” | https://www.self.inc/info/cost-of-unused-paid-subscriptions/
label: AI service
value: Hadn't used it in the past 30 days
unit: %
max: 100
---
ChatGPT | 50.4
Midjourney | 42.6
Canva AI | 40.2
Gemini | 35.3
Claude | 27.2
```

**It isn't only AI.** In the same survey, 59.9% of respondents said they had at least one paid
subscription going unused each month. Self Financial's report puts the average at 2.6 unused
subscriptions per person.

**Many paying users don't use AI every day.** Menlo Ventures and Morning Consult surveyed 5,067 U.S.
adults in July 2026. Among people who use AI, 55% pay for at least one AI product, and 50% of those
payers use AI daily (against 26% of non-payers). The other half use it less often than daily. That is
our arithmetic on Menlo's figure, not a number Menlo prints.

```figure
kind: bar
title: People who use AI daily, by whether they pay for it
caption: Among people who use AI, from a Morning Consult survey of 5,067 U.S. adults in July 2026.
source: Menlo Ventures, “2026: The State of Consumer AI” | https://menlovc.com/perspective/2026-the-state-of-consumer-ai/
label: AI users
value: Use AI daily
unit: %
max: 100
---
Pay for at least one AI product | 50
Don't pay | 26
```

**People use several assistants.** In the same Menlo survey, the average AI user now uses 3.0 general AI
assistants, up from 2.2 a year earlier. Bango asked 2,000 U.S. adults
who pay for at least one AI service in October 2025. The average subscriber in it pays for 4 AI tools,
about $66 a month. Menlo counts tools people use and Bango counts tools they pay for, so the two don't
add up to one figure. Together they say that one person often has more than one assistant to open on
a given day.

## What they don't say

**Usage is not value.** None of these surveys says the money was poorly spent, and we don't either. A
month without opening ChatGPT might be a quiet month, a month spent in another tool, or a plan kept for
the weeks that need it. In the Self Financial survey, 90.3% of people with a paid AI plan said the paid
version is better value than the free one.

**Nobody measured the unused part of a plan.** The surveys ask whether a plan was used at all. None of
them reports how much of its allowance, such as messages or usage limits, was left over. So we can't say how
much room a plan has.

**Thirty days is short, and the answers are self-reported.** People who hadn't opened a tool in 30 days
may open it tomorrow. Menlo's "AI user" means someone who reported using specific tools in the past six
months. Self Financial's page says its respondents came from "a range of backgrounds" and doesn't say how
they were chosen. Its average of unused subscriptions rose from 0.8 in 2025 to 2.6 in 2026, so compare
its years with care.

**Everyone surveyed was in the U.S., and some pull the other way.** Bango's own headline is that 77% of
its respondents say their AI subscriptions are now essential to everyday life, and The Desk reports that
nearly two-thirds of them use AI daily. Menlo's payers are the heavier users. People who pay for AI use
it more than people who don't. Some plans sit idle while others are busy.

**We left out enterprise figures.** The seat-usage numbers we found for workplace AI tools came from
licensing consultancies we couldn't trace to a primary report, and they describe companies, not people
paying for their own plan.

## Putting the idle part to work

Filing notes is a job a waiting plan can do. Each note needs a title, a few tags, links to related notes,
and a place to live. That is how an AI finds a note again later. It is also the part people skip when
they write quickly, because it pulls their attention away from the thinking.

In rotli, the Librarian does that job in the background. It runs in the Mac app, and you choose which AI
it uses: a model that runs on your Mac, or an AI tool you already use, like Claude Code or Codex, signed
in with your own account. rotli doesn't sell an AI plan and charges nothing for AI.

When the Librarian files a note, it gives the note a place in your Library and writes a few fields at the
top of the file, called frontmatter: an area, a one-line summary, tags, and links. It never rewrites
what you wrote. The note is still a plain Markdown file in your folder, so any other app can read it, and
so can the AI you chat with later.

```figure
kind: flow
title: How the Librarian puts an idle plan to work
caption: The Librarian runs in the Mac app. It adds fields at the top of the file and never rewrites what you wrote. Secure notes never reach a remote model.
---
Your note | A plain Markdown file, written quickly
The Librarian | Files it in the background, with the AI you choose
- Your AI plan | Claude Code or Codex, signed in with your own account
- A model on your Mac | Runs on your computer, without a network
Frontmatter | An area, a one-line summary, tags, and links at the top of the file
```

Some limits worth knowing:

- A connected tool works through your own plan. Filing with it counts toward that plan's usage, the same
  as anything else you ask it. If your plan is tight, the on-device model doesn't use any plan's allowance.
- Secure notes never reach a remote model, and the Librarian leaves them alone.
- The Librarian runs only in the Mac app. Rotli Web doesn't run it.
- You can turn it off. rotli is still a complete Markdown workspace without AI.

If you already pay for an AI tool you open less than you expected, it can keep your notes in order while
you write. If you'd rather keep everything on your computer, the model on your Mac can do the same job
without a network.

## Sources

1. Self Financial, [“The Cost of Unused Paid Subscriptions 2026”](https://www.self.inc/info/cost-of-unused-paid-subscriptions/),
   a survey of 1,272 U.S. adults who pay for at least one subscription, March 2026. Source of the 30-day
   figures per AI tool, the 59.9%, the 2.6, and the 90.3%.
2. Menlo Ventures, [“2026: The State of Consumer AI”](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/),
   16 September 2026, a Morning Consult survey of 5,067 U.S. adults in July 2026. Source of the 55%, the
   50% and 26% daily use, and the 3.0 assistants.
3. Bango, [“It’s not a bubble: Over three-quarters say their AI subscriptions are now essential to everyday life”](https://bango.com/its-not-a-bubble-over-three-quarters-say-their-ai-subscriptions-are-now-essential-to-everyday-life/),
   November 2025, from the report [“The rise of the AI subscriber”](https://bango.com/reports/the-rise-of-the-ai-subscriber/),
   which describes data from 2,000 AI subscribers. Source of the 4 tools, about $66 a month, and the 77%.
   Used as context, not as evidence of idle plans.
4. The Desk, [“Bango: Americans juggling four AI-based subscriptions on average, and costs are growing”](https://thedesk.net/2025/11/bango-american-survey-subscription-ai-bundles/),
   November 2025. A news write-up, cited only for details Bango's pages omit: that the 2,000 respondents
   were U.S. adults with at least one AI subscription, that they were surveyed in October 2025 with the
   research agency 3Gem, and the daily-use figure.
