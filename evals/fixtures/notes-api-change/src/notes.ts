export interface Note {
  id: string;
  ownerId: string;
  body: string;
}

export interface Db {
  notes: Note[];
}

export function listNotes(db: Db, userId: string): Note[] {
  return db.notes.filter((note) => note.ownerId === userId);
}

export function getNote(db: Db, userId: string, id: string): Note | null {
  return db.notes.find((note) => note.id === id) ?? null;
}
