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

export function deserializeSegment<T extends { filterTags: string }>(
  s: T,
): Omit<T, "filterTags"> & { filterTags: string[] } {
  return { ...s, filterTags: decodeTags(s.filterTags) };
}

export function deserializeSegments<T extends { filterTags: string }>(
  segs: T[],
): (Omit<T, "filterTags"> & { filterTags: string[] })[] {
  return segs.map(deserializeSegment);
}

export { encodeTags, decodeTags };
