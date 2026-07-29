import { afterEach, describe, expect, it, vi } from "vitest";

import { episodesForSeries, getPlaybackInfo, homeItemFields, httpErrorMessage, imageUrl, subtitleTrackUrl, watchHistoryItemIds, type MediaItem } from "./api";

const episode = (id: string, seriesId?: string): MediaItem => ({
  Id: id,
  Name: id,
  Type: "Episode",
  SeriesId: seriesId,
});

afterEach(() => vi.unstubAllGlobals());

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

describe("playback API", () => {
  it("uses the gateway-owned endpoint without sending a browser-chosen user id", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      PlaySessionId: "play-1",
      MediaSources: [],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await getPlaybackInfo("movie-123", true);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/media/items/movie-123/playback");
    expect(JSON.parse(String(options.body))).toEqual({
      DeviceProfile: expect.any(Object),
    });
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
