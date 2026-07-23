async function loadMermaid() {
  const { default: mermaid } = await import("mermaid");
  return mermaid;
}

export function mermaidErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const detail = error as { str?: unknown; message?: unknown };
    if (typeof detail.str === "string" && detail.str) return detail.str;
    if (typeof detail.message === "string" && detail.message) return detail.message;
  }
  return String(error);
}

function cleanupMermaidOrphans(id: string): void {
  for (const candidate of [id, `d${id}`, `i${id}`]) {
    document.getElementById(candidate)?.remove();
  }
}

export async function renderMermaidElement(
  code: string,
  options: { dark: boolean; id: string },
): Promise<HTMLElement> {
  const mermaid = await loadMermaid();
  const theme = options.dark ? "dark" : "default";
  // Mermaid configuration is process-global, and the board converter also
  // initializes that same runtime. Reassert the render policy every time so a
  // conversion can never leak its font/theme/security config into note views.
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme });

  const element = document.createElement("div");
  element.className = "rotli-render-mermaid";
  if (!code.trim()) return element;
  try {
    const { svg } = await mermaid.render(options.id, code);
    element.innerHTML = svg;
    return element;
  } finally {
    cleanupMermaidOrphans(options.id);
  }
}
