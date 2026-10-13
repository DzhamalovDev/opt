import { z } from "zod";

export const noteSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(200),
  body: z.string().max(50000),
  pinned: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

export type Note = z.infer<typeof noteSchema>;

export function parseNotes(value: unknown): Note[] {
  const parsed = z.array(noteSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function mergeNotes(local: Note[], remote: Note[]): Note[] {
  const byId = new Map(remote.map((note) => [note.id, note]));
  for (const note of local) {
    const existing = byId.get(note.id);
    if (!existing || note.updatedAt > existing.updatedAt) byId.set(note.id, note);
  }
  return [...byId.values()];
}

export function newNote(): Note {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    body: "",
    pinned: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}
