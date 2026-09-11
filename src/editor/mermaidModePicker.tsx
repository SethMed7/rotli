export type WorkspaceMode = "view" | "visual" | "code";

export function MermaidModePicker({
  mode,
  onChange,
  visualEditingEnabled,
}: {
  mode: WorkspaceMode;
  onChange: (mode: WorkspaceMode) => void;
  visualEditingEnabled: boolean;
}) {
  const modes: WorkspaceMode[] = visualEditingEnabled ? ["view", "visual", "code"] : ["view", "code"];
  return (
    <div className="rotli-mermaid-mode" aria-label="Diagram mode">
      {modes.map((item) => (
        <button
          key={item}
          type="button"
          className={mode === item ? "is-active" : ""}
          aria-pressed={mode === item}
          onClick={() => onChange(item)}
        >
          {item[0]!.toUpperCase() + item.slice(1)}
        </button>
      ))}
    </div>
  );
}
