import { describe, expect, it } from "vitest";

import { episodesForSeries, type MediaItem } from "./api";

const episode = (id: string, seriesId?: string): MediaItem => ({
  Id: id,
  Name: id,
  Type: "Episode",
  SeriesId: seriesId,
});

describe("episodesForSeries", () => {
  it("removes episodes returned from a different series", () => {
    expect(episodesForSeries([
      episode("chernobyl-1", "chernobyl"),
      episode("billions-1", "billions"),
      episode("chernobyl-2", "chernobyl"),
    ], "chernobyl").map((item) => item.Id)).toEqual(["chernobyl-1", "chernobyl-2"]);
  });

  it("does not trust unscoped recursive fallback results", () => {
    expect(episodesForSeries([episode("unknown")], "chernobyl")).toEqual([]);
  });
});
