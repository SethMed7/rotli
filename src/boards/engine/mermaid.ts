/** Vendor seam for turning Mermaid source into editable Excalidraw elements. */
export async function convertMermaidToBoardScene(definition: string): Promise<{
  elements: readonly unknown[];
  files: Record<string, unknown>;
}> {
  const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements }] = await Promise.all([
    import("@excalidraw/mermaid-to-excalidraw"),
    import("@excalidraw/excalidraw"),
  ]);
  const converted = await parseMermaidToExcalidraw(definition, {
    startOnLoad: false,
    maxEdges: 500,
    maxTextSize: 50_000,
    flowchart: { curve: "linear" },
  });
  return {
    elements: convertToExcalidrawElements(converted.elements, {
      regenerateIds: true,
    }),
    files: (converted.files ?? {}) as unknown as Record<string, unknown>,
  };
}
