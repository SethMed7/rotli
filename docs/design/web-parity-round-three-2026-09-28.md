# Round Three on Rotli Web (evaluation)

Status: evaluation (2026-09-28). The owner: "evaluate what changes here need
to be put in web too." Each feature in the Round Three batch, checked against
the Rotli Web build (`PLATFORM === "web"`, served under `/app/`).

## Fixed with the batch

| Feature | What was wrong on web | Fix |
|---|---|---|
| Ambient audio | Tracks asked for `/ambient/…`, but the app lives under `/app/`, so the request reached the marketing site and nothing played | `ambientSrc` prefixes the build's base (`src/lib/ambient.ts`) |
| Show in Rotli | Hiding Search removed the only way into the palette (⌘K belongs to the browser on web); the Browser switch did nothing | Neither is offered on web, and a Search hidden earlier still shows (`visibilitySettings.tsx`, `titlebar.tsx`) |
| `/librarian` | Opened a bar that could only say "works in the Mac app" | Left out of the slash menu on web (`filterSlashItems`) |
| What's new 1.6.0 | "Chat shows pictures and video" and "Find lights up every match" read as working on web | Tagged "Mac app only" (`src/assets/whats-new.json`) |

## Already right

- Bold and italic across lines, and over partly bold text: editor code, same
  on both.
- Hand to AI, from the palette, the note's menu and `/hand to AI`: built from
  the note alone, copied with the browser's clipboard.
- Quokka moods, boards matching the theme, the sidebar's Feedback button.

## Mac-only by design

- **Librarian bar and its conversation:** the organizer runs in the app's Rust
  side, against the vault's projections.
- **Claude FM, a tab's speaker, tucking a tab into the player:** they need the
  native private browser. Claude FM is already left out of every web list.
- **Leftover note names:** Settings says "In the Mac app." A web pass over
  frontmatter is possible (M), but only worth it for a folder also used by the
  Mac app.

## Worth building next (the owner's call)

| Gap | Size | Notes |
|---|---|---|
| A first-run moment on web: the thank-you card and the Sound step when an empty folder becomes a vault | M | Web has no setup flow. The card's download path already works in a browser. Every web e2e that connects an empty folder needs the card closed first |
| Chat video and artifact thumbnails through the web file store | M | Only for people paired with Rotli Helper. The store serves image types only today, so a video shows its name |
| What's new for existing web users | S | Web never sets `onboarded`, so the once-per-update card never shows there. The palette command works |
