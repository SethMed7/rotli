import { describe, expect, test } from "bun:test";
import { convertDocxPreview, documentPreviewDoc, sanitizeDocumentHtml } from "./preview";

// Minimal valid OOXML package: title, paragraph, and a 2×2 table. Kept inline
// so the test is hermetic and exercises Mammoth's actual unzip/parser path.
const DOCX_FIXTURE =
  "UEsDBAoAAAAAABu86lzmdcR+iwEAAIsBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDw/eG1sIHZlcnNpb249IjEuMCI/PjxUeXBlcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9jb250ZW50LXR5cGVzIj48RGVmYXVsdCBFeHRlbnNpb249InJlbHMiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtcGFja2FnZS5yZWxhdGlvbnNoaXBzK3htbCIvPjxEZWZhdWx0IEV4dGVuc2lvbj0ieG1sIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24veG1sIi8+PE92ZXJyaWRlIFBhcnROYW1lPSIvd29yZC9kb2N1bWVudC54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQud29yZHByb2Nlc3NpbmdtbC5kb2N1bWVudC5tYWluK3htbCIvPjwvVHlwZXM+UEsDBAoAAAAAABu86lwAAAAAAAAAAAAAAAAGAAAAX3JlbHMvUEsDBAoAAAAAABu86lxfM5VSBwEAAAcBAAALAAAAX3JlbHMvLnJlbHM8P3htbCB2ZXJzaW9uPSIxLjAiPz48UmVsYXRpb25zaGlwcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9yZWxhdGlvbnNoaXBzIj48UmVsYXRpb25zaGlwIElkPSJySWQxIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL29mZmljZURvY3VtZW50IiBUYXJnZXQ9IndvcmQvZG9jdW1lbnQueG1sIi8+PC9SZWxhdGlvbnNoaXBzPlBLAwQKAAAAAAAbvOpcAAAAAAAAAAAAAAAABQAAAHdvcmQvUEsDBAoAAAAAABu86lzUtnPZbQIAAG0CAAARAAAAd29yZC9kb2N1bWVudC54bWw8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+PHc6ZG9jdW1lbnQgeG1sbnM6dz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3dvcmRwcm9jZXNzaW5nbWwvMjAwNi9tYWluIj48dzpib2R5Pjx3OnA+PHc6cFByPjx3OnBTdHlsZSB3OnZhbD0iVGl0bGUiLz48L3c6cFByPjx3OnI+PHc6dD5Sb3RsaSBkb2N1bWVudCB3b3JrZmxvdzwvdzp0PjwvdzpyPjwvdzpwPjx3OnA+PHc6cj48dzp0PkEgbG9jYWwgRE9DWCBwcmV2aWV3IHRoYXQgbmV2ZXIgd3JpdGVzIHRoZSBzb3VyY2UgZmlsZS48L3c6dD48L3c6cj48L3c6cD48dzp0Ymw+PHc6dHI+PHc6dGM+PHc6cD48dzpyPjx3OnQ+Q2FwYWJpbGl0eTwvdzp0PjwvdzpyPjwvdzpwPjwvdzp0Yz48dzp0Yz48dzpwPjx3OnI+PHc6dD5TdGF0dXM8L3c6dD48L3c6cj48L3c6cD48L3c6dGM+PC93OnRyPjx3OnRyPjx3OnRjPjx3OnA+PHc6cj48dzp0PldvcmQgcHJldmlldzwvdzp0PjwvdzpyPjwvdzpwPjwvdzp0Yz48dzp0Yz48dzpwPjx3OnI+PHc6dD5SZWFkeTwvdzp0PjwvdzpyPjwvdzpwPjwvdzp0Yz48L3c6dHI+PC93OnRibD48dzpzZWN0UHIvPjwvdzpib2R5Pjwvdzpkb2N1bWVudD5QSwECFAAKAAAAAAAbvOpc5nXEfosBAACLAQAAEwAAAAAAAAAAAAAAAAAAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAAoAAAAAABu86lwAAAAAAAAAAAAAAAAGAAAAAAAAAAAAEAAAALwBAABfcmVscy9QSwECFAAKAAAAAAAbvOpcXzOVUgcBAAAHAQAACwAAAAAAAAAAAAAAAADgAQAAX3JlbHMvLnJlbHNQSwECFAAKAAAAAAAbvOpcAAAAAAAAAAAAAAAABQAAAAAAAAAAABAAAAAQAwAAd29yZC9QSwECFAAKAAAAAAAbvOpc1LZz2W0CAABtAgAAEQAAAAAAAAAAAAAAAAAzAwAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAUABQAgAQAAzwUAAAAA";

describe("document preview safety", () => {
  test("converts a real DOCX paragraph and table through the local parser", async () => {
    const result = await convertDocxPreview(DOCX_FIXTURE);
    expect(result.srcDoc).toContain("Rotli document workflow");
    expect(result.srcDoc).toContain("A local DOCX preview");
    expect(result.srcDoc).toContain("<table>");
    expect(result.srcDoc).toContain("Word preview");
    expect(result.srcDoc).toContain("Ready");
  });

  test("strips active content, navigation, event handlers, and remote images", () => {
    const clean = sanitizeDocumentHtml(
      '<h1 onclick="steal()">Hello</h1><script>alert(1)</script><a href="https://example.com">site</a><img src="https://example.com/pixel"><img src="data:image/png;base64,AA==">',
    );
    expect(clean).toContain("<h1>Hello</h1>");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("href=");
    expect(clean).not.toContain("https://example.com");
    expect(clean).toContain('src="data:image/png;base64,AA=="');
  });

  test("wraps semantic HTML in a no-network, no-script document", () => {
    const doc = documentPreviewDoc("<h1>Brief</h1><p>Body</p>");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("img-src data:");
    expect(doc).toContain("<body><h1>Brief</h1><p>Body</p></body>");
  });
});
