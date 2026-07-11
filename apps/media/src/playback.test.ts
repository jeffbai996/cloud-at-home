import { describe, expect, it } from "vitest";

import { activeCueText, captionFontSize, formatPlaybackStats, isResumable, mediaYearLabel, pauseCinemaVisible, playbackStartPosition, progressEvents, resumePosition, shouldReportProgress, subtitleTrackLabel, trickplayFrame, webPlaybackProfile } from "./playback";

describe("web playback capabilities", () => {
  it("direct-plays browser-safe video and transcodes incompatible containers or audio to HLS", () => {
    expect(webPlaybackProfile.DirectPlayProfiles).toContainEqual(expect.objectContaining({
      Container: "mp4,m4v",
      VideoCodec: "h264",
      AudioCodec: "aac,mp3,ac3",
    }));
    expect(webPlaybackProfile.DirectPlayProfiles.some((profile) => profile.Container.includes("mkv"))).toBe(false);
    expect(webPlaybackProfile.TranscodingProfiles).toContainEqual(expect.objectContaining({
      Protocol: "hls",
      VideoCodec: "h264",
      AudioCodec: "aac",
    }));
  });
});

describe("player preferences", () => {
  it("defaults captions to 75 percent and clamps saved values to 0-200", () => {
    expect(captionFontSize(undefined)).toBe(75);
    expect(captionFontSize(-10)).toBe(0);
    expect(captionFontSize(143)).toBe(143);
    expect(captionFontSize(260)).toBe(200);
  });

  it("enters pause cinema only after ten seconds and leaves immediately", () => {
    expect(pauseCinemaVisible(true, 9_999)).toBe(false);
    expect(pauseCinemaVisible(true, 10_000)).toBe(true);
    expect(pauseCinemaVisible(false, 30_000)).toBe(false);
  });

  it("formats real playback diagnostics without inventing unavailable values", () => {
    expect(formatPlaybackStats({
      width: 1920,
      height: 1080,
      mode: "Direct play",
      container: "mkv",
      videoCodec: "hevc",
      audioCodec: "aac",
      bufferedSeconds: 18.46,
      droppedFrames: 3,
      totalFrames: 2400,
      rate: 1.25,
    })).toEqual([
      ["Resolution", "1920 × 1080"],
      ["Playback", "Direct play"],
      ["Container", "MKV"],
      ["Video", "HEVC"],
      ["Audio", "AAC"],
      ["Buffer", "18.5 s"],
      ["Frames", "3 dropped / 2,400"],
      ["Speed", "1.25×"],
    ]);
  });
});

describe("playback progress", () => {
  it("reports every five seconds while playing", () => {
    expect(shouldReportProgress({ previous: 10, current: 14.9, paused: false })).toBe(false);
    expect(shouldReportProgress({ previous: 10, current: 15, paused: false })).toBe(true);
  });

  it("always reports pause and large seeks", () => {
    expect(shouldReportProgress({ previous: 10, current: 11, paused: true })).toBe(true);
    expect(shouldReportProgress({ previous: 10, current: 42, paused: false })).toBe(true);
  });

  it("includes every lifecycle event that can lose resume state", () => {
    expect(progressEvents).toEqual([
      "pause",
      "seeked",
      "visibilitychange",
      "pagehide",
      "airplaychange",
      "teardown",
    ]);
  });
});

describe("resume position", () => {
  it("clamps a saved position inside the playable duration", () => {
    expect(resumePosition(125, 600)).toBe(125);
    expect(resumePosition(900, 600)).toBe(599);
    expect(resumePosition(-20, 600)).toBe(0);
  });

  it("keeps the saved position when duration is not known yet", () => {
    expect(resumePosition(125, Number.NaN)).toBe(125);
  });

  it("starts at zero when the user chooses play from beginning", () => {
    expect(playbackStartPosition(125, 600, true)).toBe(0);
    expect(playbackStartPosition(125, 600, false)).toBe(125);
  });

  it("offers resume only for unfinished items with saved progress", () => {
    expect(isResumable(125_000_000, false)).toBe(true);
    expect(isResumable(0, false)).toBe(false);
    expect(isResumable(125_000_000, true)).toBe(false);
  });
});

describe("player year labels", () => {
  it("formats movies and ended or ongoing series", () => {
    expect(mediaYearLabel({ Type: "Movie", ProductionYear: 2023 })).toBe("2023");
    expect(mediaYearLabel({ Type: "Episode", SeriesName: "Example", SeriesProductionYear: 2008, SeriesEndDate: "2015-12-31T00:00:00Z" })).toBe("2008 – 2015");
    expect(mediaYearLabel({ Type: "Episode", SeriesName: "Example", SeriesProductionYear: 2019, SeriesEndDate: "2019-05-06T00:00:00Z" })).toBe("2019");
    expect(mediaYearLabel({ Type: "Episode", SeriesName: "Example", SeriesProductionYear: 2008 })).toBe("2008 –");
    expect(mediaYearLabel({ Type: "Episode", SeriesName: "Example" })).toBe("");
  });
});

describe("subtitle cues", () => {
  it("joins active cues, strips markup, and clears when no cue is active", () => {
    expect(activeCueText([{ text: "<i>Hello</i>" }, { text: "world" }])).toBe("Hello\nworld");
    expect(activeCueText([])).toBe("");
    expect(activeCueText(null)).toBe("");
  });

  it("removes implementation details from track labels", () => {
    expect(subtitleTrackLabel({ Index: 3, DisplayTitle: "English - SUBRIP - External" })).toBe("English");
    expect(subtitleTrackLabel({ Index: 4, DisplayTitle: "Chinese Simplified | SRT | External" })).toBe("Chinese Simplified");
    expect(subtitleTrackLabel({ Index: 5, Language: "eng" })).toBe("English");
  });
});

describe("trickplay frames", () => {
  const info = { Width: 320, Height: 180, TileWidth: 5, TileHeight: 5, ThumbnailCount: 60, Interval: 10_000, Bandwidth: 0 };

  it("maps playback time to the correct sprite tile and cell", () => {
    expect(trickplayFrame(0, info)).toMatchObject({ tile: 0, column: 0, row: 0 });
    expect(trickplayFrame(240, info)).toMatchObject({ tile: 0, column: 4, row: 4 });
    expect(trickplayFrame(250, info)).toMatchObject({ tile: 1, column: 0, row: 0 });
  });

  it("clamps past the final generated thumbnail", () => {
    expect(trickplayFrame(9999, info)).toMatchObject({ tile: 2, column: 4, row: 1 });
  });
});
