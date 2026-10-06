---
title: Paid AI plans often sit unopened. rotli can put them to work.
description: What recent surveys say about paid AI plans that go unused, what they can't say, how developers and everyday users differ, and how rotli's Librarian files your notes with a plan you already have or a model on your Mac.
section: post
tags: [AI, Research, Librarian]
date: 2026-10-06
---

We can't tell you how much of your AI plan goes unused. No survey we found measures that. What surveys
can tell us is how many people pay for an AI tool and then haven't opened it lately. That number is
large enough to matter. It is why rotli doesn't sell an AI plan of its own, and puts the one you
already have to work instead. This post sets out the numbers, who was asked, what they leave out, and
how the answer differs for a developer and for someone who only uses a chat app.

## What the numbers say

**Many paying users hadn't opened their plan in a month.** In March 2026, Self Financial surveyed 1,272
U.S. adults "from a range of backgrounds" about subscription services. It asked about ten paid AI
services. Among respondents who had each one, the share who hadn't used it in the past 30 days was:

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
caption: Five of the ten paid AI services in the survey, each among the respondents who had it. Self Financial surveyed 1,272 U.S. adults in March 2026.
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
subscriptions per person, up from 0.8 in its 2025 edition.

**Half of paying users don't use AI every day.** Menlo Ventures and Morning Consult surveyed 5,067 U.S.
adults in July 2026, weighted to be nationally representative. Among people who use AI, 55% pay for at
least one AI product. Among those payers, 50% use AI daily, against 26% of non-payers. The other half of
payers use it less often than daily. That is our arithmetic on Menlo's figure, not a number Menlo prints.

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
assistants, up from 2.2 a year earlier. Bango's research on AI subscribers reports that the average
subscriber pays for 4 AI tools, almost $66 a month. Menlo counts tools people use and Bango counts tools
they pay for, so the two don't add up to one figure. Together they say that one person often has more
than one assistant to open on a given day.

**Few people run into their limits.** This is the one datum we found on it, and it is old and narrow. In
August 2025, Anthropic emailed Claude Max subscribers that its new weekly limits would affect "less than
5% of users based on current usage patterns." That was one provider, one plan tier, and a year ago. It
says nothing about any plan today, but it points the same way as the surveys above: most paying users
don't use all of what they pay for.

## What they don't say

**Usage is not value.** None of these surveys says the money was poorly spent, and we don't either. A
month without opening ChatGPT might be a quiet month, a month spent in another tool, or a plan kept for
the weeks that need it. In the Self Financial survey, 90.3% of people with a paid AI plan said the paid
version is better value than the free one.

**Nobody measured the unused part of a plan.** The surveys ask whether a plan was used at all. None of
them reports how much of its allowance was left over. So we can't say how much room a plan has, and we
can't say how much room filing notes would take.

**Thirty days is short, and the answers are self-reported.** People who hadn't opened a tool in 30 days
may open it tomorrow. Menlo's "AI user" means someone who reported using specific tools in the past six
months. Self Financial's page says its respondents came from "a range of backgrounds" and doesn't say how
they were chosen, so compare its years with care.

**Everyone surveyed was in the U.S., and some pull the other way.** Bango's own headline is that 77% of
its subscribers say their AI services are now essential to their everyday life. Bango's pages don't say
who was surveyed or when, so we use it only as context. Menlo's payers are the heavier users: people who
pay for AI use it more than people who don't. Some plans sit idle while others are busy.

**We left out enterprise figures.** The seat-usage numbers we found for workplace AI tools came from
licensing consultancies we couldn't trace to a primary report, and they describe companies, not people
paying for their own plan.

## Two readers, two kinds of use

"Someone with an AI plan" covers two quite different people, and the sources describe them separately.

**Most use is everyday use.** OpenAI's economists studied ChatGPT messages through July 2025. More than
70% were not about paid work. Practical guidance, seeking information, and writing made up nearly 80% of
conversations, and computer programming was a small share. Anthropic's Economic Index, covering April to
June 2026, found personal use in Claude chat and Cowork conversations at about 35% on weekdays and just
under 50% on weekends.

**Developers are a smaller group that uses different tools.** JetBrains surveyed more than 10,000
professional developers in January 2026. 90% used at least one AI tool at work, and 74% used tools built
for developers rather than a chatbot. GitHub Copilot (29%) and ChatGPT (28%) were the most used at
work, Claude Code and Cursor were at 18% each, and Codex was at 3%. Even among developers, the tools
we're about to name were not universal.

```figure
kind: bar
title: Professional developers using each AI tool at work
caption: From JetBrains' January 2026 survey of more than 10,000 professional developers. Chatbot and coding-tool figures are the share who used each one at work.
source: JetBrains Research, “Which AI coding tools do developers actually use at work?” | https://blog.jetbrains.com/research/2026/04/which-ai-coding-tools-do-developers-actually-use-at-work/
label: Tool
value: Used at work
unit: %
max: 100
---
GitHub Copilot | 29
ChatGPT (chatbot) | 28
Claude Code | 18
Cursor | 18
Codex | 3
```

Menlo's survey sits between the two. It finds that 65% of people who pay for AI use agents, against 13%
of non-payers, and that 24% of AI users use one regularly. Menlo means agent features in consumer apps
there, such as assistants that act on your email or browser. It doesn't separate developers from
everyone else, and it isn't a count of people who run command-line tools.

## What your plan may already include

Two of the tools a connected Librarian can run through are made by the companies behind the plans in
these surveys:

- **Claude Code** is included with Claude Pro and Max. Anthropic says usage is shared across Claude and
  Claude Code, so activity in either counts against the same limit. Pro and Max both also have a weekly
  limit that resets at a fixed time each week.
- **Codex** is included with every ChatGPT plan, Free and Go through Enterprise, according to OpenAI's
  plan page. Plus has a five-hour limit, weekly limits may also apply, and Pro has no five-hour limit.

Limits change often, so check your own plan's page. The point is that the tool is probably already
covered by what you pay for. Whether you have ever opened it is a separate question. Among professional
developers, only 18% used Claude Code and 3% used Codex at work, and we found no survey of everyone else.

## Putting the idle part to work

Filing notes is a job a waiting plan can do. Each note needs a title, a few tags, links to related notes,
and a place to live. That is how an AI finds a note again later. It is also the part people skip when
they write quickly, because it pulls their attention away from the thinking.

In rotli, the Librarian does that job in the background. It runs in the Mac app, and you choose what it
works with: **On this Mac**, which is a model that runs on your computer, or **Claude**, **ChatGPT**, or
**Gemini**, signed in with your own account. rotli doesn't sell an AI plan and charges nothing for AI.

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
- Your AI plan | Claude, ChatGPT, or Gemini, signed in with your own account
- A model on your Mac | Runs on your computer, without a network
Frontmatter | An area, a one-line summary, tags, and links at the top of the file
```

### Which path fits you

- **If you already use one of these tools,** choose it. Filing draws on the plan you already pay for, the
  same as anything else you ask that tool to do. That is real usage, so if you run close to your limit,
  filing can bring it closer.
- **If you only use a chat app, or none,** use the model on your Mac. It needs no account and no plan,
  and it doesn't draw on anyone's allowance. It does need memory. In our own measurements the model rotli
  uses takes about 8 GB while it is loaded, which a Mac with 16 GB of memory can hold, but only just. Check
  what the Librarian screen says about your Mac before you rely on it.

If you pay for a tool and you're unsure which path to take, start on the Mac model. You can switch the
Librarian to your plan later, and back.

### Limits worth knowing

- **A connected Librarian sends notes to that provider.** It files on a quiet timer, so every note it
  files goes to the provider you chose, with no click for each one. You turn the connection on in
  Settings, and the Librarian says which one it is using.
- **Secure and locked notes are skipped.** Secure notes never reach a remote model, and the Librarian
  leaves them alone.
- **It runs only in the Mac app.** Rotli Web doesn't run it.
- **You can turn it off.** rotli is still a complete Markdown workspace without AI.

## Sources

1. Self Financial, [“The Cost of Unused Paid Subscriptions 2026”](https://www.self.inc/info/cost-of-unused-paid-subscriptions/),
   a survey of 1,272 U.S. adults, March 2026. Source of the 30-day figures per AI tool, the 59.9%, the
   2.6 (up from 0.8 in 2025), and the 90.3%.
2. Menlo Ventures, [“2026: The State of Consumer AI”](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/),
   16 September 2026, a Morning Consult survey of 5,067 U.S. adults in July 2026. Source of the 55%, the
   50% and 26% daily use, the 3.0 assistants, and the 65%, 13%, and 24% agent figures.
3. Bango, [“It’s not a bubble: Over three-quarters say their AI subscriptions are now essential to everyday life”](https://bango.com/its-not-a-bubble-over-three-quarters-say-their-ai-subscriptions-are-now-essential-to-everyday-life/),
   November 2025, from the report [“The rise of the AI subscriber”](https://bango.com/reports/the-rise-of-the-ai-subscriber/).
   Source of the 4 tools, almost $66 a month, and the 77%. Its pages do not give a sample size or survey
   date, so this is context, not evidence of idle plans.
4. Chatterji, Cunningham, Deming, Hitzig, Ong, Shan and Wadman, [“How People Use ChatGPT”](https://www.nber.org/papers/w34255),
   NBER, September 2025, covering messages from November 2022 to July 2025. Source of the more than 70%
   non-work share and the three leading use categories.
5. Anthropic, [“Economic Index report: Cadences”](https://www.anthropic.com/research/economic-index-june-2026-report),
   26 June 2026, covering 10 April to 10 June 2026. Source of the 35% weekday and just-under-50% weekend
   personal-use figures for chat and Cowork.
6. JetBrains Research, [“Which AI coding tools do developers actually use at work?”](https://blog.jetbrains.com/research/2026/04/which-ai-coding-tools-do-developers-actually-use-at-work/),
   a January 2026 survey of more than 10,000 professional developers. Source of the 90%, the 74%, and the
   per-tool figures.
7. Anthropic, [“Use Claude Code with your Pro or Max plan”](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan),
   support article. Source of Claude Code being included in Pro and Max and of usage being shared with
   Claude. The weekly-limit reset is from Anthropic's Pro and Max plan articles.
8. OpenAI, [ChatGPT plans and Codex usage](https://learn.chatgpt.com/docs/pricing), the plan page that
   replaced developers.openai.com/codex/pricing. Source of Codex being included in every ChatGPT plan and
   of the five-hour and weekly limits. It carries no date, so check it for current figures.
9. Stark Insider, [“Anthropic adds weekly limits to Claude, cites abuses”](https://www.starkinsider.com/2025/07/anthropic-adds-weekly-limits-to-claude-cites-abuses.html),
   which reproduces in full an email from Anthropic to Claude Max subscribers. We cite it only for the
   “less than 5% of users” statement, which comes from that email and not from a report we could read at
   Anthropic.
