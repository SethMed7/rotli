// The thank-you card after onboarding (2026-09-28): what its banner says and
// where its share buttons go. Pure: the card draws and the services open.
//
// Shares carry ONLY a fixed line and the site — never the person's name or
// any choice they made (that would be personal data leaving through a link
// or a share sheet).

export const SITE_URL = "https://rotli.co";

export const SHARE_CAPTION =
  "I just set up Rotli: a calm, local-first workspace for notes, tasks, and AI, in one folder I own.";

/** The line the share sheet carries beside the link (Messages, Mail…). */
export const SHARE_MESSAGE =
  "I’ve started using Rotli for notes. It keeps everything in a folder on your Mac, no account needed.";

export function shareOnXUrl(): string {
  const params = new URLSearchParams({ text: SHARE_CAPTION, url: SITE_URL });
  return `https://x.com/intent/post?${params.toString()}`;
}

/** How a Share click ended: a share sheet opened, the line went on the
 * clipboard instead, the person closed the sheet, or nothing worked. */
export type ShareOutcome = "sheet" | "copied" | "cancelled" | "failed";

/** What the card says after Share. A sheet speaks for itself. */
export function shareStatus(outcome: ShareOutcome): string {
  switch (outcome) {
    case "copied":
      return "The link to Rotli is copied. Paste it anywhere.";
    case "failed":
      return `Couldn’t share from here. Rotli lives at ${SITE_URL.replace("https://", "")}.`;
    default:
      return "";
  }
}

export interface BannerText {
  headline: string;
  subline: string;
}

const NAME_LIMIT = 24;

/** First name, trimmed to fit the headline. */
function shortName(userName: string): string {
  const first = userName.trim().split(/\s+/)[0] ?? "";
  return first.length > NAME_LIMIT ? `${first.slice(0, NAME_LIMIT - 1)}…` : first;
}

/** A thank-you, by first name (the owner, 2026-10-02: "more of a thank you
 * message, less of a welcome", and no badges for the choices made). */
export function bannerText(userName: string): BannerText {
  const name = shortName(userName);
  return {
    headline: name ? `Thank you, ${name}` : "Thank you",
    subline: "for trying Rotli. We’re so glad you’re here.",
  };
}
