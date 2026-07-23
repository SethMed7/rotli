export const BOARD_LIMITS = {
  maxBytes: 8_000_000,
  maxElements: 10_000,
  maxActions: 500,
  maxStringChars: 100_000,
  maxCoordinate: 10_000_000,
  maxFiles: 1_000,
  maxDepth: 64,
  maxNodes: 200_000,
} as const;

export class BoardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardValidationError";
  }
}

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BoardValidationError(message);
  }
}

function validateValue(value: unknown, depth: number, budget: { nodes: number }): void {
  if (depth > BOARD_LIMITS.maxDepth) throw new BoardValidationError("Board data is nested too deeply");
  budget.nodes += 1;
  if (budget.nodes > BOARD_LIMITS.maxNodes) throw new BoardValidationError("Board has too much nested data");
  if (typeof value === "string" && [...value].length > BOARD_LIMITS.maxStringChars) {
    throw new BoardValidationError("Board contains a string that is too long");
  }
  if (Array.isArray(value)) {
    for (const child of value) validateValue(child, depth + 1, budget);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if ([...key].length > 256) throw new BoardValidationError("Board contains an invalid field name");
      if (["x", "y", "width", "height"].includes(key) && typeof child === "number") {
        if (!Number.isFinite(child) || Math.abs(child) > BOARD_LIMITS.maxCoordinate) {
          throw new BoardValidationError("Board contains a coordinate outside the supported range");
        }
      }
      if (key === "points" && Array.isArray(child)) validatePoints(child);
      validateValue(child, depth + 1, budget);
    }
  }
}

function validatePoints(points: unknown[]): void {
  for (const point of points) {
    if (!Array.isArray(point)) continue;
    for (const coordinate of point) {
      if (
        typeof coordinate === "number" &&
        (!Number.isFinite(coordinate) || Math.abs(coordinate) > BOARD_LIMITS.maxCoordinate)
      ) {
        throw new BoardValidationError("Board contains a coordinate outside the supported range");
      }
    }
  }
}

export function parseAndValidateBoard(source: string): Record<string, unknown> {
  if (new TextEncoder().encode(source).byteLength > BOARD_LIMITS.maxBytes) {
    throw new BoardValidationError("Board is larger than the 8 MB safety limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new BoardValidationError(
      "The board file contains invalid JSON. The original file was not changed.",
    );
  }
  assertObject(parsed, "Board root must be an object");
  if (parsed.type !== "excalidraw") throw new BoardValidationError("Board type must be excalidraw");
  if (!Array.isArray(parsed.elements)) throw new BoardValidationError("Board elements must be an array");
  if (parsed.elements.length > BOARD_LIMITS.maxElements) {
    throw new BoardValidationError("Board has too many elements");
  }
  if (
    parsed.elements.some(
      (element) => typeof element !== "object" || element === null || Array.isArray(element),
    )
  ) {
    throw new BoardValidationError("Board elements must be objects");
  }
  if (parsed.appState !== undefined) assertObject(parsed.appState, "Board appState must be an object");
  if (parsed.files !== undefined) {
    assertObject(parsed.files, "Board files must be an object");
    if (Object.keys(parsed.files).length > BOARD_LIMITS.maxFiles) {
      throw new BoardValidationError("Board has too many embedded files");
    }
  }
  if (parsed.rotliMeta !== undefined) {
    assertObject(parsed.rotliMeta, "Board rotliMeta must be an object");
    for (const field of ["description", "tags"] as const) {
      const value = parsed.rotliMeta[field];
      if (value !== undefined && typeof value !== "string") {
        throw new BoardValidationError(`Board rotliMeta ${field} must be a string`);
      }
    }
  }
  validateValue(parsed, 0, { nodes: 0 });
  return parsed;
}
