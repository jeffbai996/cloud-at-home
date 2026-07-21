import { describe, expect, it } from "vitest";

import { episodesForSeries, homeItemFields, httpErrorMessage, imageUrl, subtitleTrackUrl, watchHistoryItemIds, type MediaItem } from "./api";

const episode = (id: string, seriesId?: string): MediaItem => ({
  Id: id,
  Name: id,
  Type: "Episode",
  SeriesId: seriesId,
});

describe("watchHistoryItemIds", () => {
  it("combines completed and resumable items without clearing an item twice", () => {
    expect(watchHistoryItemIds(
      [episode("played-1"), episode("overlap")],
      [episode("resume-1"), episode("overlap")],
    )).toEqual(["played-1", "overlap", "resume-1"]);
  });
});

describe("media errors", () => {
  it("turns bare status codes into useful descriptions", () => {
    expect(httpErrorMessage(500)).toBe("500: Server error — the service could not complete the request.");
    expect(httpErrorMessage(404)).toBe("404: Not found — the requested media resource is unavailable.");
    expect(httpErrorMessage(502, "Bad Gateway", "Jellyfin is unavailable")).toBe("502: Jellyfin is unavailable");
  });

  it("uses a stable same-origin subtitle URL that native iOS fullscreen can load", () => {
    expect(subtitleTrackUrl("movie-123", "source-456", 3)).toBe("/api/media/subtitles/movie-123/source-456/3.vtt");
  });
});

describe("media artwork", () => {
  it("uses Jellyfin image tags to invalidate stale poster caches", () => {
    const item: MediaItem = { Id: "movie-1", Name: "Example", Type: "Movie", ImageTags: { Primary: "poster-v2" } };
    expect(imageUrl(item)).toContain("tag=poster-v2");
  });
});

describe("home library payload", () => {
  it("defers heavyweight playback sources until a title is played", () => {
    expect(homeItemFields.split(",")).not.toContain("MediaSources");
  });
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
