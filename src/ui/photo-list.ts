/**
 * Updates to a return's list of photo ids, applied to the latest list (as React state updates),
 * so an upload that finishes after another one, or after a remove, never brings back an old list.
 */
export function addPhoto(list: readonly string[], id: string, max: number): string[] {
  if (list.includes(id) || list.length >= max) return [...list];
  return [...list, id];
}

export function removePhoto(list: readonly string[], id: string): string[] {
  return list.filter((x) => x !== id);
}
