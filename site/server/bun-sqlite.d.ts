// The slice of Bun's built-in `bun:sqlite` the sidecar uses (roadmap.ts and the owner's
// site/scripts/roadmap-requests.ts), declared here so `astro check` can type them without
// adding @types/bun to the site's dependencies. Bun provides the module at runtime.
declare module 'bun:sqlite' {
  type Binding = string | number | bigint | boolean | null | Uint8Array;

  export class Statement<Row = unknown, Params extends Binding[] = Binding[]> {
    all(...params: Params): Row[];
    get(...params: Params): Row | null;
    run(...params: Params): { changes: number; lastInsertRowid: number | bigint };
  }

  export class Database {
    constructor(filename?: string, options?: { create?: boolean; readonly?: boolean; readwrite?: boolean; strict?: boolean });
    run(sql: string, ...params: Binding[]): { changes: number; lastInsertRowid: number | bigint };
    query<Row = unknown, Params extends Binding[] = Binding[]>(sql: string): Statement<Row, Params>;
    close(throwOnError?: boolean): void;
  }
}
