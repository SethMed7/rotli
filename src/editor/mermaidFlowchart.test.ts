import { describe, expect, test } from "bun:test";

import { nextMermaidNodeId, parseMermaidFlowchart, serializeMermaidFlowchart } from "./mermaidFlowchart";

const portableColor = (value: string) => `#${value}`;
const pipeEntity = "#" + "124;";

describe("Mermaid visual flowchart contract", () => {
  test("reads legacy shapes, labeled edges, and portable node colors", () => {
    const result = parseMermaidFlowchart(`flowchart LR
  Start([Start]) -->|Continue| Decide{Ready?}
  Decide -.-> Store[(Notes)]
  style Decide fill:${portableColor("f1e7d8")},stroke:${portableColor("8f4e37")},color:${portableColor("3a3028")}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.direction).toBe("LR");
    expect(result.model.nodes.map(({ id, shape }) => ({ id, shape }))).toEqual([
      { id: "Start", shape: "stadium" },
      { id: "Decide", shape: "diamond" },
      { id: "Store", shape: "cyl" },
    ]);
    expect(result.model.edges[0]?.label).toBe("Continue");
    expect(result.model.edges[1]?.kind).toBe("dotted");
    expect(result.model.nodes[1]?.style).toEqual({
      fill: portableColor("f1e7d8"),
      stroke: portableColor("8f4e37"),
      color: portableColor("3a3028"),
    });
  });

  test("round-trips the supported expanded shape syntax deterministically", () => {
    const source = `flowchart TD
  %% A readable comment
  Start@{ shape: circle, label: "Begin" }
  Work@{ shape: subproc, label: "Do work" }
  Stop@{ shape: dbl-circ, label: "Done" }
  Start ==> Work
  Work -->|Finish| Stop`;
    const first = parseMermaidFlowchart(source);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const serialized = serializeMermaidFlowchart(first.model);
    const second = parseMermaidFlowchart(serialized);
    expect(second).toEqual(first);
  });

  test("preserves pipe characters in visual connection labels as Mermaid entity codes", () => {
    const result = parseMermaidFlowchart("flowchart LR\n  A --> B");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.model.edges[0] = { ...result.model.edges[0]!, label: "yes | no" };
    const serialized = serializeMermaidFlowchart(result.model);
    expect(serialized).toContain(`|yes ${pipeEntity} no|`);
    const reparsed = parseMermaidFlowchart(serialized);
    expect(reparsed.ok && reparsed.model.edges[0]?.label).toBe("yes | no");
  });

  test("fails closed for diagram families and syntax it cannot safely preserve", () => {
    expect(parseMermaidFlowchart("sequenceDiagram\n  Alice->>Bob: Hello")).toMatchObject({
      ok: false,
      line: 1,
    });
    expect(parseMermaidFlowchart("flowchart LR\n  subgraph Group\n  A --> B\n  end")).toMatchObject({
      ok: false,
      line: 2,
    });
    expect(parseMermaidFlowchart("flowchart LR\n  A --> B --> C")).toMatchObject({
      ok: false,
      line: 2,
    });
    expect(parseMermaidFlowchart("flowchart LR\n  A --> B\n  style A stroke-width:4px")).toMatchObject({
      ok: false,
      line: 3,
    });
    expect(
      parseMermaidFlowchart("%%{ init: { 'flowchart': { 'curve': 'step' } } }%%\nflowchart LR\n  A --> B"),
    ).toMatchObject({
      ok: false,
      line: 1,
    });
  });

  test("allocates collision-free readable ids", () => {
    expect(
      nextMermaidNodeId([
        { id: "node2", label: "Existing", shape: "rect", style: {} },
        { id: "node3", label: "Existing", shape: "rect", style: {} },
      ]),
    ).toBe("node4");
  });
});
