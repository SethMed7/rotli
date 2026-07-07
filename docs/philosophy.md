# rotli — Philosophy

The emotional contract. Read before making design or feature decisions. If a proposed feature conflicts with the principles here, the feature is wrong.

Where [model.md](./model.md) governs the objects and vocabulary and [vision.md](./vision.md) governs the shape of the whole, this doc governs the soul of every surface.

---

## The question that defines us

Why would someone with a busy life — ten inboxes, twenty meetings a week, thoughts scattered across six apps — choose yet another tool?

The answer is not more features. The answer is cognitive quiet.

Every productivity app the user tried before rotli had a resting pulse that was *too high.* A dock icon with a badge. A sidebar that never fully collapses. A notification sound that fires for every email. An interface that assumes your attention is cheap. By the end of the day the user is tired not because of what they did, but because of how many small demands their tools kept making on them.

rotli makes no demands. It waits for you. You summon it, it's there. You dismiss it, it's gone. While it's open, nothing on the screen is competing for your eyes. While it's closed, nothing is flashing for your attention.

That is the promise.

---

## The promise

**Other productivity tools say:** *"I will help you do more."*

**rotli says:** *"I will quietly hold what matters, and I will not get in your way."*

The difference is where the pulse lives. In most tools, the app itself has a pulse — it pings, it badges, it updates in the corner, it demands to be checked. In rotli, only your work has a pulse. The app sits behind it, warm and patient, and does exactly what you ask, never more.

**Warm. Quiet. Instant.** — a visitor on your screen, not a resident.

---

## The quokka principle

The user is a quokka on Rottnest Island. Small, focused, always smiling — because the environment around them was designed *for them.* Nothing surprises them. Nothing has to be learned. Every icon has a label. Every hotkey can be rebound. Every corner of the app is as calm as every other.

The quokka never has to ask: "what does this button do?" The quokka never has to think: "where did my thing go?" The quokka never has to fight the tool to accomplish the thing they opened it for.

If a user ever thinks *"wait, how do I…"* about something they should obviously be able to do, the design is wrong. Fix the design.

---

## Core principles

### 1. The window is a visitor, not a resident

The app lives in the menu bar. When you need it, you summon it with `⌥Space`. When you're done, it disappears — click away, press `Esc`, it's gone. It never sits on the screen demanding attention. It never occupies dock space. It never shows up in `⌘Tab`. No badges, no pings.

This is structural. A resident app starts collecting obligations — "I should check my email," "I should see if anyone replied," "I should deal with that thing." A visitor app collects none. You only interact with it when you're already thinking about the task it serves.

**Design rule:** every surface assumes the user just summoned it seconds ago and will dismiss it in seconds more. Don't design for long dwell time. Design for fast arrival and fast exit.

### 2. Warmth under lamplight

The screen is an LCD; the light is direct; the default of most apps is blue and cold. rotli is linen, clay, and amber — every surface feels like paper under a desk lamp, not a monitor under an LED. This isn't a theme; it's the defaults.

- Light mode is warm linen, never pure white.
- Dark mode is warm dark, never clinical gray.
- A neutral pair — **Paper** (simple white & ink) and **Charcoal** — sits alongside the warm two for a cooler, quieter ground: four themes in all, with a **Liquid Glass** mode layerable over any of them.
- The clay accent marks moments, never the whole interface. One signature, not a theme park.

**Design rule:** after thirty minutes of use, your eyes should feel like you've been reading a book, not looking at a monitor. If a surface violates that feeling, redesign it.

### 3. Everything is instant

Pressing the hotkey and waiting for the window to animate in is friction. Waiting for notes to load is friction. Waiting for search to return results is friction. Waiting for the cursor to catch up to your keystrokes is friction. All of it is the enemy.

Instant is not a performance goal — it's a design goal. If a feature can't be made to feel instant, redesign the feature, not the performance budget.

- `⌥Space` → window visible in under 80ms.
- Typing → characters visible on the same frame.
- Tab switch → content visible in under 16ms.
- Command palette → results visible before the second keystroke lands.

**Design rule:** long operations (indexing, AI organizing, email fetch) run in the background, invisibly. The user never sees a spinner for something they didn't explicitly request.

### 4. Local is a feeling, not just an engineering choice

The app works offline. The app works without signing in. Your notes are plain files in one folder you own — a memex on your own Mac. That's engineering. The *feeling* is different: knowing that your notes are yours, your thinking stays on your machine — that's what local-first is *for.* It's the same feeling as keeping a paper journal in a desk drawer. No one else can read it. It won't disappear because a server did.

**Design rule:** every integration that reaches the network must be framed as a choice the user made, not a default they accepted. Sync is opt-in. A connected AI model is a choice, and a note flagged **secure** never leaves the machine. Email accounts are per-account. Nothing phones home silently.

### 5. Every control earns its place

The default state of any surface is empty. A button gets added only when its absence becomes a problem. A setting gets added only when not having it is worse than the cognitive cost of it being there.

**The work is sacred, and everything else serves it.** The work is the notes you're writing, the email you're replying to, the thought you just captured. Chrome exists only to make those things faster — never to demand your attention.

**Design rule:** when adding a new UI element, justify its existence in one sentence. If the sentence reads like "it would be nice to have," don't add it.

### 6. The user owns the app

Every hotkey is rebindable. Every font is resizeable. Every color is switchable. Every notification style is configurable. Every integration is optional. The app is a tool the user shapes to their life, not a workflow the user conforms to.

**Design rule:** opinions live in defaults, not in enforcement. If the user wants to turn a principle off, let them.

### 7. Quietness is a feature

Notifications don't ping by default. Badges don't pulse. The app doesn't notify you about itself (it doesn't say "sync complete," it doesn't celebrate when you hit a streak, it doesn't ask you to rate it). The only notifications it produces are for genuinely external events — a new email, a scheduled reminder — and those are redactable, mutable, and auto-silenced when your screen is being shared.

**Design rule:** any feature that would make the app noisier needs a very high justification bar, and its default state is off.

---

## What we optimize for

In priority order:

1. **Cognitive quiet.** The app should feel calm. Empty surfaces beat busy ones. Absence beats noise.
2. **Instantness.** Every interaction feels like the app anticipated it. No loading states for things the user is already doing.
3. **Warmth.** Every surface reads as "comfortable." Cool color, cold feel, clinical framing — all banned.
4. **Local safety.** The user's data is the user's data. Nothing leaves the machine without an explicit, granular choice.
5. **Rebindability.** Every behavior is tunable to the user's preferences.
6. **Reliability.** Notes never disappear. Auto-save always works. Offline is indistinguishable from online for everything except email fetching.

---

## What we refuse to be

- **Not a dopamine engine.** No streaks, no achievements, no "you've done X today" dashboards. Productivity tools that gamify attention are making the problem worse.
- **Not a growth vehicle.** No referral banners, no upsell prompts, no "try this feature" modals. The app's only job is to help the user, not to convert them into a pro plan.
- **Not a workflow.** We don't tell you how to manage your day. We give you a warm surface to manage it however you already do.
- **Not an everything app.** A few well-contained fronts. The user picks what they need. Nothing nags them about the ones they don't use.
- **Not an AI product.** rotli can talk to AI models — on-device by default, or your own connected models — because it's useful. We don't lead with AI, we don't sprinkle AI into surfaces where it isn't earning its place, and we don't market the app on AI features. It's a productivity tool that happens to have a smart answer surface. And the AI organizes *quietly*: it only ever changes a note's location and metadata, never its words.

---

## The test

Before any feature, surface, or design decision ships, ask:

> After thirty minutes of using this, does the user feel calmer than when they started?

If the answer is "yes" — ship. If "no" — redesign until the answer changes.

---

## What this doc is not

- **Not a design spec.** [design-system.md](./design-system.md) owns visual rules.
- **Not a product model.** [model.md](./model.md) owns the objects and vocabulary; [vision.md](./vision.md) owns the shape of the whole.
- **Not iPad.** The future pen-first iPad direction has its own emotional contract — see [future/ipad-handdrawing-chandra.md](./future/ipad-handdrawing-chandra.md).
