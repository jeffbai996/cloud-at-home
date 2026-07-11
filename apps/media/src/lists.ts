import type { MediaItem } from "./api";

export const MAX_LIST_NAME_LENGTH = 18;

export type MediaList = {
  id: string;
  name: string;
  items: MediaItem[];
};

export function normalizeListName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_LIST_NAME_LENGTH);
}

export function createMediaList(current: MediaList[], name: string, id: string): MediaList[] {
  const normalized = normalizeListName(name);
  if (!normalized) return current;
  return [...current, { id, name: normalized, items: [] }];
}

export function toggleListItem(list: MediaList, item: MediaItem): MediaList {
  const included = list.items.some((entry) => entry.Id === item.Id);
  return {
    ...list,
    items: included ? list.items.filter((entry) => entry.Id !== item.Id) : [item, ...list.items],
  };
}

export function validPromotedListId(lists: MediaList[], promotedId: string | null): string | null {
  if (promotedId && lists.some((list) => list.id === promotedId)) return promotedId;
  return lists[0]?.id ?? null;
}
