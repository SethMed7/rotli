// The secure flip, apart from its effects so it is testable as it stands: read
// the note's OWN flag (never a cached guess), write the opposite, answer the new
// state. A note whose frontmatter cannot be read counts as not secure, so the
// first press always protects.

export interface SecureIo {
  read: (noteId: string) => Promise<{ secure: boolean } | null>;
  write: (noteId: string, secure: boolean) => Promise<void>;
}

export async function flipSecure(noteId: string, io: SecureIo): Promise<boolean> {
  const secure = !(await io.read(noteId))?.secure;
  await io.write(noteId, secure);
  return secure;
}
