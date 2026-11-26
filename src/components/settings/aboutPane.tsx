// Settings → About Rotli: the app, its version, and where it comes from. The
// version and the external-link opener come from settingsSurface (the native
// adapter owner), so this pane stays presentation only. A host build may
// replace or drop Rotli's wording and links (host/registry.ts); the version
// row and the third-party credits stay.
import { aboutBody, hostVersion, productName } from "../../host/registry";
import { ExternalLinkGlyph } from "../glyphs";

export const ROTLI_WEBSITE_URL = "https://sethmedina.com";

/** The open-source editors inside Rotli (the owner, 2026-10-01: "in the about
 * part mention that we have Excalidraw and Univer integrated in"). */
export const BUILT_IN = [
  { name: "Excalidraw", url: "https://excalidraw.com", what: "draws your boards" },
  { name: "Univer", url: "https://univer.ai", what: "edits your Word documents" },
] as const;

export function AboutPane({
  version,
  feedbackUrl,
  onOpenUrl,
}: {
  /** The installed bundle version; null in the browser preview. */
  version: string | null;
  /** A prefilled new issue (lib/feedback) — version and OS family only. */
  feedbackUrl: string;
  onOpenUrl: (url: string) => void;
}) {
  // undefined: Rotli's own words and links; anything else is a host's wording
  const hostBody = aboutBody();
  const rotli = hostBody === undefined;
  const name = productName();
  const shown = hostVersion() ?? version;
  return (
    <>
      {rotli ? (
        <p className="lead">
          Rotli is a warm, local-first notes app for the Mac, built by Seth Medina. Your notes are plain
          Markdown files in a folder you choose, so they stay yours and open in any editor. The Librarian runs
          on this Mac by default, and a connected AI model is always your explicit choice. Rotli is a window
          onto your files, never their owner.
        </p>
      ) : (
        hostBody && <p className="lead">{hostBody}</p>
      )}
      <div className="setselect-row">
        <span>{shown ? `${name} ${shown}` : `${name} — version shown in the Mac app`}</span>
      </div>
      {rotli && (
        <a
          className="ghostbtn about-link"
          href={ROTLI_WEBSITE_URL}
          onClick={(event) => {
            event.preventDefault();
            onOpenUrl(ROTLI_WEBSITE_URL);
          }}
        >
          <span>Website — sethmedina.com</span>
          <ExternalLinkGlyph size={13} />
        </a>
      )}
      {/* attribution for code every build ships, a host's included */}
      <h4 className="sethead">Built in</h4>
      <p className="setnote">
        {`Two open-source editors live inside ${name} and save to ordinary files in your vault:`}{" "}
        {BUILT_IN.map((editor, index) => (
          <span key={editor.name}>
            <a
              className="about-inline-link"
              href={editor.url}
              onClick={(event) => {
                event.preventDefault();
                onOpenUrl(editor.url);
              }}
            >
              {editor.name}
            </a>{" "}
            {editor.what}
            {index === BUILT_IN.length - 1 ? "." : ", and "}
          </span>
        ))}
      </p>
      {rotli && (
        <>
          <a
            className="ghostbtn about-link"
            href={feedbackUrl}
            onClick={(event) => {
              event.preventDefault();
              onOpenUrl(feedbackUrl);
            }}
          >
            <span>Send feedback — opens an issue on GitHub</span>
            <ExternalLinkGlyph size={13} />
          </a>
          <p className="setnote">
            The issue starts with your Rotli version and operating system, nothing else. Issues are public, so
            leave out anything private.
          </p>
        </>
      )}
    </>
  );
}
