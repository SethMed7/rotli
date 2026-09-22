// The policy every previewed piece of HTML runs under (a ```html fence, an
// .html file): no network at all, on any host — the app's own origin
// included, since Rotli Web's page policy allows 'self' and a note must not be
// able to send its text there in a request. Local images and inline styles
// still show. Stacked inside the sandboxed srcdoc frame, on top of the app's.
export const HTML_PREVIEW_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: asset:; media-src data: blob: asset:; style-src 'unsafe-inline'; font-src data:">`;
