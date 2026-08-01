// One way to render a caught value for a log line. `catch (e)` binds `unknown`,
// and the two obvious spellings both lose information: `${e}` in a template is
// a type error under restrict-template-expressions, and `String(e)` on a plain
// object writes the literal "[object Object]" into breve.log — the exact line a
// human reads when a delivery failed at 06:00. Errors surrender their message,
// everything else is JSON so the shape survives.

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") return String(err);
  if (err === null || err === undefined) return "unknown error";
  try {
    return JSON.stringify(err) ?? "unknown error";
  } catch {
    return "unserializable error";
  }
}
