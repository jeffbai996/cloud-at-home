import { describe, expect, it } from "vitest";

import type { MediaItem } from "./api";
import { createMediaList, MAX_LIST_NAME_LENGTH, normalizeListName, toggleListItem, validPromotedListId, type MediaList } from "./lists";

const movie = (Id: string): MediaItem => ({ Id, Name: Id, Type: "Movie" });

describe("custom media lists", () => {
  it("normalizes whitespace and clamps names before they reach navigation", () => {
    expect(normalizeListName("  Weekend    movies  ")).toBe("Weekend movies");
    expect(normalizeListName("x".repeat(30))).toHaveLength(MAX_LIST_NAME_LENGTH);
  });

  it("creates only named lists", () => {
    expect(createMediaList([], "  ", "ignored")).toEqual([]);
    expect(createMediaList([], "Date night", "list-1")).toEqual([{ id: "list-1", name: "Date night", items: [] }]);
  });

  it("toggles a title without creating duplicates", () => {
    const list: MediaList = { id: "list-1", name: "Date night", items: [] };
    const added = toggleListItem(list, movie("one"));
    expect(added.items.map((item) => item.Id)).toEqual(["one"]);
    expect(toggleListItem(added, movie("one")).items).toEqual([]);
  });

  it("promotes the first list when no valid promoted list remains", () => {
    const lists: MediaList[] = [
      { id: "first", name: "First", items: [] },
      { id: "second", name: "Second", items: [] },
    ];
    expect(validPromotedListId(lists, null)).toBe("first");
    expect(validPromotedListId(lists, "second")).toBe("second");
    expect(validPromotedListId(lists, "deleted")).toBe("first");
    expect(validPromotedListId([], "deleted")).toBeNull();
  });
});
