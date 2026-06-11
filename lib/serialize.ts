import { decodeTags, encodeTags } from "./tags";

// Deserialize a raw DB contact row → TS-friendly shape with string[] tags
export function deserializeContact<T extends { tags: string }>(
  c: T,
): Omit<T, "tags"> & { tags: string[] } {
  return { ...c, tags: decodeTags(c.tags) };
}

export function deserializeContacts<T extends { tags: string }>(
  contacts: T[],
): (Omit<T, "tags"> & { tags: string[] })[] {
  return contacts.map(deserializeContact);
}

export function deserializeSegment<T extends { filterTags: string; manualIds?: string }>(
  s: T,
): Omit<T, "filterTags" | "manualIds"> & { filterTags: string[]; manualIds: string[] } {
  return {
    ...s,
    filterTags: decodeTags(s.filterTags),
    manualIds: decodeTags((s as { manualIds?: string }).manualIds ?? "[]"),
  };
}

export function deserializeSegments<T extends { filterTags: string; manualIds?: string }>(
  segs: T[],
): (Omit<T, "filterTags" | "manualIds"> & { filterTags: string[]; manualIds: string[] })[] {
  return segs.map(deserializeSegment);
}

export { encodeTags, decodeTags };
