// Settings → About Rotli: the app, its version, and where it comes from. The
// version and the external-link opener come from settingsSurface (the native
// adapter owner), so this pane stays presentation only.
import { ExternalLinkGlyph } from "../glyphs";

export const ROTLI_WEBSITE_URL = "https://sethmedina.com";

export function AboutPane({
  version,
  onOpenWebsite,
}: {
  /** The installed bundle version; null in the browser preview. */
  version: string | null;
  onOpenWebsite: (url: string) => void;
}) {
  return (
    <>
      <p className="lead">
        Rotli is a warm, local-first notes app for the Mac, built by Seth Medina. Your notes are plain
        Markdown files in a folder you choose, so they stay yours and open in any editor. The Librarian runs
        on this Mac by default, and a connected AI model is always your explicit choice. Rotli is a window
        onto your files, never their owner.
      </p>
      <div className="setselect-row">
        <span>{version ? `Rotli ${version}` : "Rotli — version shown in the Mac app"}</span>
      </div>
      <a
        className="ghostbtn about-link"
        href={ROTLI_WEBSITE_URL}
        onClick={(event) => {
          event.preventDefault();
          onOpenWebsite(ROTLI_WEBSITE_URL);
        }}
      >
        <span>Website — sethmedina.com</span>
        <ExternalLinkGlyph size={13} />
      </a>
    </>
  );
}
