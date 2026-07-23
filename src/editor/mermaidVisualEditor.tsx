import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MERMAID_FLOW_DIRECTIONS,
  MERMAID_NODE_SHAPES,
  type MermaidEdgeKind,
  type MermaidFlowEdge,
  type MermaidFlowNode,
  type MermaidFlowchart,
  type MermaidNodeShape,
  type MermaidNodeStyle,
  nextMermaidNodeId,
  parseMermaidFlowchart,
  serializeMermaidFlowchart,
} from "./mermaidFlowchart";
import {
  type MermaidCanvasPoint,
  MERMAID_VISUAL_NODE_SIZE,
  layoutMermaidFlowchart,
} from "./mermaidFlowLayout";

interface MermaidVisualEditorProps {
  applyError: string;
  dirty: boolean;
  source: string;
  onApply(): void;
  onChange(source: string): void;
  onEditCode(): void;
}

type VisualSelection = { kind: "node" | "edge"; id: string } | null;

interface NodeDrag {
  id: string;
  pointerId: number;
  start: MermaidCanvasPoint;
  origin: MermaidCanvasPoint;
}

const COLOR_CHOICES = [
  { label: "Accent", token: "--accent" },
  { label: "Soft", token: "--tint" },
  { label: "Paper", token: "--surface" },
  { label: "Ink", token: "--text" },
] as const;

function resolvedTokenHex(token: string): string | null {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (!rgb) return null;
  return `#${rgb
    .slice(1, 4)
    .map((component) => Number(component).toString(16).padStart(2, "0"))
    .join("")}`;
}

function copyModel(model: MermaidFlowchart): MermaidFlowchart {
  return {
    ...model,
    comments: [...model.comments],
    nodes: model.nodes.map((node) => ({ ...node, style: { ...node.style } })),
    edges: model.edges.map((edge) => ({ ...edge })),
  };
}

function lineDash(kind: MermaidEdgeKind): string | undefined {
  return kind === "dotted" ? "7 6" : undefined;
}

function lineWidth(kind: MermaidEdgeKind): number {
  return kind === "thick" ? 3 : 1.5;
}

function shapeName(shape: MermaidNodeShape): string {
  return MERMAID_NODE_SHAPES.find((candidate) => candidate.id === shape)?.label ?? "Shape";
}

function nodeStyle(node: MermaidFlowNode): CSSProperties {
  return {
    "--mermaid-node-fill": node.style.fill ?? "var(--surface)",
    "--mermaid-node-stroke": node.style.stroke ?? "var(--border-strong)",
    "--mermaid-node-text": node.style.color ?? "var(--text)",
  } as CSSProperties;
}

function ColorControl({
  label,
  property,
  value,
  onChange,
}: {
  label: string;
  property: keyof MermaidNodeStyle;
  value: string | undefined;
  onChange(property: keyof MermaidNodeStyle, value: string | undefined): void;
}) {
  return (
    <fieldset className="rotli-mermaid-color-control">
      <legend>{label}</legend>
      <div>
        {COLOR_CHOICES.map((choice) => (
          <button
            key={choice.token}
            type="button"
            className={value === resolvedTokenHex(choice.token) ? "is-active" : ""}
            aria-label={`Set ${label.toLowerCase()} to ${choice.label}`}
            title={choice.label}
            style={{ background: `var(${choice.token})` }}
            onClick={() => {
              const color = resolvedTokenHex(choice.token);
              if (color) onChange(property, color);
            }}
          />
        ))}
        <label className="rotli-mermaid-custom-color" title={`Choose custom ${label.toLowerCase()}`}>
          <span>Custom {label.toLowerCase()}</span>
          <input
            key={`${property}-${value ?? "default"}`}
            type="color"
            aria-label={`Custom ${label.toLowerCase()}`}
            defaultValue={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : undefined}
            onChange={(event) => onChange(property, event.target.value)}
          />
        </label>
        <button
          type="button"
          className="rotli-mermaid-color-reset"
          disabled={!value}
          onClick={() => onChange(property, undefined)}
        >
          Default
        </button>
      </div>
    </fieldset>
  );
}

function MermaidNodeInspector({
  node,
  onConnect,
  onDelete,
  onUpdate,
}: {
  node: MermaidFlowNode;
  onConnect(): void;
  onDelete(): void;
  onUpdate(next: MermaidFlowNode): void;
}) {
  const updateStyle = (property: keyof MermaidNodeStyle, value: string | undefined) => {
    const style = { ...node.style, [property]: value };
    if (!value) delete style[property];
    onUpdate({ ...node, style });
  };
  return (
    <div className="rotli-mermaid-inspector-fields">
      <label>
        Text
        <textarea
          rows={3}
          value={node.label}
          aria-label="Shape text"
          onChange={(event) => onUpdate({ ...node, label: event.target.value })}
        />
      </label>
      <label>
        Shape
        <select
          value={node.shape}
          aria-label="Shape type"
          onChange={(event) => onUpdate({ ...node, shape: event.target.value as MermaidNodeShape })}
        >
          {MERMAID_NODE_SHAPES.map((shape) => (
            <option key={shape.id} value={shape.id}>
              {shape.label}
            </option>
          ))}
        </select>
      </label>
      <ColorControl label="Fill" property="fill" value={node.style.fill} onChange={updateStyle} />
      <ColorControl label="Border" property="stroke" value={node.style.stroke} onChange={updateStyle} />
      <ColorControl label="Text" property="color" value={node.style.color} onChange={updateStyle} />
      <div className="rotli-mermaid-inspector-actions">
        <button type="button" onClick={onConnect}>
          Draw arrow
        </button>
        <button type="button" className="is-destructive" onClick={onDelete}>
          Delete shape
        </button>
      </div>
    </div>
  );
}

function MermaidEdgeInspector({
  edge,
  onDelete,
  onUpdate,
}: {
  edge: MermaidFlowEdge;
  onDelete(): void;
  onUpdate(next: MermaidFlowEdge): void;
}) {
  return (
    <div className="rotli-mermaid-inspector-fields">
      <label>
        Arrow text
        <input
          value={edge.label}
          aria-label="Arrow text"
          onChange={(event) => onUpdate({ ...edge, label: event.target.value })}
        />
      </label>
      <label>
        Line
        <select
          value={edge.kind}
          aria-label="Arrow style"
          onChange={(event) => onUpdate({ ...edge, kind: event.target.value as MermaidEdgeKind })}
        >
          <option value="arrow">Arrow</option>
          <option value="line">Line</option>
          <option value="dotted">Dotted arrow</option>
          <option value="thick">Thick arrow</option>
        </select>
      </label>
      <button type="button" className="is-destructive" onClick={onDelete}>
        Delete connection
      </button>
    </div>
  );
}

export function MermaidVisualEditor({
  applyError,
  dirty,
  source,
  onApply,
  onChange,
  onEditCode,
}: MermaidVisualEditorProps) {
  const parsed = useMemo(() => parseMermaidFlowchart(source), [source]);
  const model = parsed.ok ? parsed.model : null;
  const automaticLayout = useMemo(() => (model ? layoutMermaidFlowchart(model) : null), [model]);
  const [positions, setPositions] = useState<Record<string, MermaidCanvasPoint>>({});
  const [selection, setSelection] = useState<VisualSelection>(null);
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const dragRef = useRef<NodeDrag | null>(null);

  useEffect(() => {
    if (!automaticLayout || !model) return;
    setPositions(
      (current) =>
        Object.fromEntries(
          model.nodes.map((node) => [node.id, current[node.id] ?? automaticLayout.positions[node.id]]),
        ) as Record<string, MermaidCanvasPoint>,
    );
  }, [automaticLayout, model]);

  const commit = useCallback(
    (next: MermaidFlowchart) => {
      onChange(serializeMermaidFlowchart(next));
    },
    [onChange],
  );

  const updateNode = useCallback(
    (nextNode: MermaidFlowNode) => {
      if (!model) return;
      const next = copyModel(model);
      next.nodes = next.nodes.map((node) => (node.id === nextNode.id ? nextNode : node));
      commit(next);
    },
    [commit, model],
  );

  const updateEdge = useCallback(
    (nextEdge: MermaidFlowEdge) => {
      if (!model) return;
      const next = copyModel(model);
      next.edges = next.edges.map((edge) => (edge.id === nextEdge.id ? nextEdge : edge));
      commit(next);
    },
    [commit, model],
  );

  const deleteSelection = useCallback(() => {
    if (!model || !selection) return;
    const next = copyModel(model);
    if (selection.kind === "node") {
      next.nodes = next.nodes.filter((node) => node.id !== selection.id);
      next.edges = next.edges.filter((edge) => edge.from !== selection.id && edge.to !== selection.id);
    } else {
      next.edges = next.edges.filter((edge) => edge.id !== selection.id);
    }
    setSelection(null);
    setPendingFrom(null);
    commit(next);
  }, [commit, model, selection]);

  const addNode = useCallback(
    (shape: MermaidNodeShape) => {
      if (!model) return;
      const next = copyModel(model);
      const id = nextMermaidNodeId(next.nodes);
      next.nodes.push({ id, label: `New ${shapeName(shape).toLowerCase()}`, shape, style: {} });
      setSelection({ kind: "node", id });
      setShapeMenuOpen(false);
      commit(next);
    },
    [commit, model],
  );

  const connectTo = useCallback(
    (target: string) => {
      if (!model || !pendingFrom || pendingFrom === target) return;
      const next = copyModel(model);
      next.edges.push({
        id: `edge-${next.edges.length + 1}`,
        from: pendingFrom,
        to: target,
        label: "",
        kind: "arrow",
      });
      setPendingFrom(null);
      setSelection({ kind: "edge", id: `edge-${next.edges.length}` });
      commit(next);
    },
    [commit, model, pendingFrom],
  );

  const beginDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
      if (event.button !== 0 || pendingFrom) return;
      const origin = positions[id];
      if (!origin) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        id,
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        origin,
      };
      setSelection({ kind: "node", id });
    },
    [pendingFrom, positions],
  );

  const moveDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPositions((current) => ({
      ...current,
      [drag.id]: {
        x: drag.origin.x + event.clientX - drag.start.x,
        y: drag.origin.y + event.clientY - drag.start.y,
      },
    }));
  }, []);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  if (!parsed.ok || !model || !automaticLayout) {
    return (
      <div className="rotli-mermaid-visual-state" role="status">
        <strong>Visual editing is not available for this source yet.</strong>
        <span>
          {parsed.ok ? "Open Code to continue editing this diagram." : parsed.reason}
          {!parsed.ok && parsed.line ? ` (line ${parsed.line})` : ""}
        </span>
        <span>Your Mermaid source has not been changed.</span>
        <button type="button" onClick={onEditCode}>
          Open Code
        </button>
      </div>
    );
  }

  const selectedNode =
    selection?.kind === "node" ? model.nodes.find((node) => node.id === selection.id) : undefined;
  const selectedEdge =
    selection?.kind === "edge" ? model.edges.find((edge) => edge.id === selection.id) : undefined;
  const canvasWidth = Math.max(
    automaticLayout.width,
    ...Object.values(positions).map((point) => point.x + MERMAID_VISUAL_NODE_SIZE.width + 72),
  );
  const canvasHeight = Math.max(
    automaticLayout.height,
    ...Object.values(positions).map((point) => point.y + MERMAID_VISUAL_NODE_SIZE.height + 72),
  );

  return (
    <section
      className="rotli-mermaid-visual"
      aria-label="Visual Mermaid flowchart editor"
      onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key === "Escape" && pendingFrom) {
          event.preventDefault();
          event.stopPropagation();
          setPendingFrom(null);
        } else if (
          (event.key === "Delete" || event.key === "Backspace") &&
          selection &&
          !(event.target instanceof HTMLInputElement) &&
          !(event.target instanceof HTMLTextAreaElement)
        ) {
          event.preventDefault();
          deleteSelection();
        }
      }}
    >
      <div className="rotli-mermaid-visual-tools">
        <div className="rotli-mermaid-shape-menu-wrap">
          <button
            type="button"
            aria-expanded={shapeMenuOpen}
            aria-controls="rotli-mermaid-shape-menu"
            onClick={() => setShapeMenuOpen((open) => !open)}
          >
            + Shape
          </button>
          {shapeMenuOpen && (
            <div id="rotli-mermaid-shape-menu" className="rotli-mermaid-shape-menu" role="menu">
              {MERMAID_NODE_SHAPES.map((shape) => (
                <button key={shape.id} type="button" role="menuitem" onClick={() => addNode(shape.id)}>
                  <span className="rotli-mermaid-shape-preview" data-shape={shape.id} />
                  {shape.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <label>
          Direction
          <select
            value={model.direction}
            aria-label="Flowchart direction"
            onChange={(event) => {
              const next = copyModel(model);
              next.direction = event.target.value as MermaidFlowchart["direction"];
              setPositions(layoutMermaidFlowchart(next).positions);
              commit(next);
            }}
          >
            {MERMAID_FLOW_DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {direction}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!selection}
          onClick={deleteSelection}
          aria-label="Delete selected diagram item"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => setPositions(automaticLayout.positions)}
          disabled={model.nodes.length === 0}
        >
          Arrange
        </button>
        <span>Drag shapes to work. Mermaid arranges the saved diagram automatically.</span>
      </div>

      {pendingFrom && (
        <div className="rotli-mermaid-connect-state" role="status">
          <span>Choose another shape to draw an arrow.</span>
          <button type="button" onClick={() => setPendingFrom(null)}>
            Cancel
          </button>
        </div>
      )}

      <div className="rotli-mermaid-visual-body">
        <div
          className="rotli-mermaid-visual-scroll"
          aria-label="Flowchart editing canvas"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelection(null);
          }}
        >
          {model.nodes.length === 0 ? (
            <div className="rotli-mermaid-empty-canvas">
              <strong>This flowchart is empty.</strong>
              <span>Add a shape to begin.</span>
              <button type="button" onClick={() => addNode("rect")}>
                Add first shape
              </button>
            </div>
          ) : (
            <div
              className={
                pendingFrom ? "rotli-mermaid-visual-canvas is-connecting" : "rotli-mermaid-visual-canvas"
              }
              style={{ width: canvasWidth, height: canvasHeight }}
            >
              <svg
                className="rotli-mermaid-visual-edges"
                width={canvasWidth}
                height={canvasHeight}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="rotli-mermaid-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 z" />
                  </marker>
                </defs>
                {model.edges.map((edge) => {
                  const from = positions[edge.from];
                  const to = positions[edge.to];
                  if (!from || !to) return null;
                  const x1 = from.x + MERMAID_VISUAL_NODE_SIZE.width / 2;
                  const y1 = from.y + MERMAID_VISUAL_NODE_SIZE.height / 2;
                  const x2 = to.x + MERMAID_VISUAL_NODE_SIZE.width / 2;
                  const y2 = to.y + MERMAID_VISUAL_NODE_SIZE.height / 2;
                  return (
                    <g key={edge.id} className={selection?.id === edge.id ? "is-selected" : ""}>
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        strokeDasharray={lineDash(edge.kind)}
                        strokeWidth={lineWidth(edge.kind)}
                        markerEnd={edge.kind === "line" ? undefined : "url(#rotli-mermaid-arrow)"}
                      />
                      {edge.label && (
                        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle">
                          {edge.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              {model.nodes.map((node) => {
                const point = positions[node.id] ?? automaticLayout.positions[node.id];
                if (!point) return null;
                const selected = selection?.kind === "node" && selection.id === node.id;
                return (
                  <div
                    key={node.id}
                    className="rotli-mermaid-visual-node-wrap"
                    data-node-id={node.id}
                    style={{ left: point.x, top: point.y }}
                  >
                    <button
                      type="button"
                      className={
                        selected ? "rotli-mermaid-visual-node is-selected" : "rotli-mermaid-visual-node"
                      }
                      data-shape={node.shape}
                      style={nodeStyle(node)}
                      aria-label={`${node.label}, ${shapeName(node.shape)} shape`}
                      onPointerDown={(event) => beginDrag(event, node.id)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onClick={() => {
                        if (pendingFrom && pendingFrom !== node.id) connectTo(node.id);
                        else setSelection({ kind: "node", id: node.id });
                      }}
                      onKeyDown={(event) => {
                        if (!event.altKey || !event.key.startsWith("Arrow")) return;
                        event.preventDefault();
                        const delta = 8;
                        setPositions((current) => ({
                          ...current,
                          [node.id]: {
                            x:
                              point.x +
                              (event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0),
                            y:
                              point.y +
                              (event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0),
                          },
                        }));
                      }}
                    >
                      <span>{node.label}</span>
                    </button>
                    <button
                      type="button"
                      className="rotli-mermaid-node-port"
                      aria-label={`Draw arrow from ${node.label}`}
                      aria-pressed={pendingFrom === node.id}
                      onClick={() => {
                        setSelection({ kind: "node", id: node.id });
                        setPendingFrom((current) => (current === node.id ? null : node.id));
                      }}
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="rotli-mermaid-inspector" aria-label="Diagram inspector">
          <header>
            <strong>{selectedNode ? "Shape" : selectedEdge ? "Connection" : "Inspector"}</strong>
            {selectedNode && <span>{selectedNode.id}</span>}
          </header>
          {selectedNode ? (
            <MermaidNodeInspector
              node={selectedNode}
              onUpdate={updateNode}
              onConnect={() => setPendingFrom(selectedNode.id)}
              onDelete={deleteSelection}
            />
          ) : selectedEdge ? (
            <MermaidEdgeInspector edge={selectedEdge} onUpdate={updateEdge} onDelete={deleteSelection} />
          ) : (
            <div className="rotli-mermaid-inspector-empty">
              <span>Select a shape to edit it.</span>
            </div>
          )}
          {model.edges.length > 0 && (
            <div className="rotli-mermaid-connection-list">
              <strong>Connections</strong>
              {model.edges.map((edge) => (
                <button
                  key={edge.id}
                  type="button"
                  className={selection?.kind === "edge" && selection.id === edge.id ? "is-active" : ""}
                  onClick={() => setSelection({ kind: "edge", id: edge.id })}
                >
                  {edge.from} → {edge.to}
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>

      <footer className="rotli-mermaid-visual-footer">
        {applyError ? (
          <span className="rotli-mermaid-apply-error" role="alert">
            {applyError}
          </span>
        ) : (
          <span>Changes stay in this workspace until you apply them to the Markdown fence.</span>
        )}
        <button type="button" className="is-primary" disabled={!dirty} onClick={onApply}>
          Apply to note
        </button>
      </footer>
    </section>
  );
}
