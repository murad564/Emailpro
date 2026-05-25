export function encodeTags(tags: string[]): string {
  return JSON.stringify(tags);
}

export function decodeTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

export function contactHasAnyTag(tagsJson: string, filterTags: string[]): boolean {
  if (filterTags.length === 0) return true;
  const tags = decodeTags(tagsJson);
  return filterTags.some((t) => tags.includes(t));
}
