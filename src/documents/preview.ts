import mammoth from "mammoth";
import type { DocumentPreviewContent, DocumentPreviewer } from "./ports";

export type DocumentPreviewResult = DocumentPreviewContent;

function bytesFromBase64(base64: string): ArrayBuffer {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Mammoth intentionally emits semantic HTML instead of reproducing Word's page
 * chrome. Rotli puts that HTML in an empty sandbox and strips every navigation,
 * active-content, and remote-resource path before it reaches the frame.
 */
export function sanitizeDocumentHtml(html: string): string {
  return html
    .replace(/<(script|iframe|object|embed|form|input|button|textarea|select|link|meta|base)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|iframe|object|embed|form|input|button|textarea|select|link|meta|base)\b[^>]*\/?\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:href|srcset)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+src\s*=\s*(["'])(?!data:image\/)[\s\S]*?\1/gi, "");
}

export function documentPreviewDoc(body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto;
    max-width: 760px;
    padding: 54px 64px 80px;
    color: rgb(38 37 35);
    background: white;
    font: 16px/1.62 ui-serif, Georgia, Cambria, "Times New Roman", serif;
    overflow-wrap: anywhere;
  }
  h1, h2, h3, h4 { color: rgb(27 26 24); line-height: 1.22; margin: 1.5em 0 .55em; }
  h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.2em; }
  p, ul, ol, table, blockquote { margin: 0 0 1em; }
  ul, ol { padding-left: 1.5em; }
  blockquote { margin-left: 0; padding-left: 1em; border-left: 2px solid rgb(205 201 194); color: rgb(88 84 78); }
  table { width: 100%; border-collapse: collapse; font-family: ui-sans-serif, system-ui, sans-serif; font-size: .9em; }
  th, td { padding: .45em .6em; border: 1px solid rgb(205 201 194); text-align: left; vertical-align: top; }
  img { display: block; max-width: 100%; height: auto; margin: 1.25em auto; }
  a { color: inherit; text-decoration: underline; text-decoration-color: rgb(150 145 137); }
  pre, code { font-family: ui-monospace, Menlo, monospace; font-size: .9em; }
  @media (max-width: 620px) { body { padding: 34px 28px 56px; } }
</style>
</head>
<body>${sanitizeDocumentHtml(body)}</body>
</html>`;
}

export async function convertDocxPreview(base64: string): Promise<DocumentPreviewResult> {
  const arrayBuffer = bytesFromBase64(base64);
  type MammothInput = Parameters<typeof mammoth.convertToHtml>[0];
  // Mammoth selects a browser unzip adapter in Vite and its Node adapter under
  // Bun tests. Both accept the same bytes but name the field differently.
  const input: MammothInput =
    "Bun" in globalThis || typeof window === "undefined"
      ? ({ buffer: new Uint8Array(arrayBuffer) } as unknown as MammothInput)
      : { arrayBuffer };
  const result = await mammoth.convertToHtml(
    input,
    {
      externalFileAccess: false,
      includeEmbeddedStyleMap: true,
      includeDefaultStyleMap: true,
      convertImage: mammoth.images.dataUri,
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => p.subtitle:fresh",
      ],
    },
  );
  return {
    srcDoc: documentPreviewDoc(result.value),
    warnings: result.messages.map((message) => message.message),
  };
}

export const docxPreviewer: DocumentPreviewer = {
  preview: convertDocxPreview,
};
