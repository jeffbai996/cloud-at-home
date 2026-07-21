import { describe, expect, it } from "vitest";

import { activeCueText, airPlayNoticeDurationMs, airPlayUnavailableMessage, captionFontSize, captionLineHeight, captionPrefsVersion, captionVerticalOffset, formatPlaybackStats, fullscreenStrategy, isPlaybackToggleKey, isResumable, mediaYearLabel, migrateCaptionDefaults, pauseCinemaDelays, pauseCinemaVisible, pauseSynopsisDurationSeconds, playbackStartPosition, playerKeyboardAction, playerTitleOwners, prefersViewportFullscreen, progressEvents, resumePosition, shouldArmTitleTimer, shouldAutoPictureInPicture, shouldReportProgress, subtitleTrackLabel, titleDisplayDurationMs, trickplayFrame, webPlaybackProfile, webPlaybackProfileFor } from "./playback";

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

  it("delivers text subtitles externally instead of burning them into video", () => {
    expect(webPlaybackProfile.SubtitleProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ Format: "srt", Method: "External" }),
      expect.objectContaining({ Format: "vtt", Method: "External" }),
    ]));
  });

  it("offers HEVC direct play and fMP4 HLS stream-copy only when the browser reports support", () => {
    expect(webPlaybackProfileFor(false).DirectPlayProfiles).toEqual(webPlaybackProfile.DirectPlayProfiles);
    expect(webPlaybackProfileFor(true).DirectPlayProfiles).toContainEqual(expect.objectContaining({
      Container: "mp4,m4v",
      VideoCodec: "hevc,h265",
      AudioCodec: expect.stringContaining("eac3"),
    }));
    expect(webPlaybackProfileFor(false).DirectPlayProfiles.some((profile) => profile.VideoCodec.includes("hevc"))).toBe(false);
    expect(webPlaybackProfileFor(true).DirectPlayProfiles).toContainEqual(expect.objectContaining({
      Container: "hls",
      VideoCodec: "hevc,h264",
    }));
    expect(webPlaybackProfileFor(true).TranscodingProfiles).toContainEqual(expect.objectContaining({
      Container: "mp4",
      Protocol: "hls",
      VideoCodec: "hevc,h264",
      AudioCodec: expect.stringContaining("eac3"),
      MaxAudioChannels: "8",
      SegmentLength: 1,
    }));
    expect(webPlaybackProfileFor(false).TranscodingProfiles).toEqual(webPlaybackProfile.TranscodingProfiles);
  });
});

describe("player preferences", () => {
  it("clamps saved caption sizes to 0-200", () => {
    expect(captionFontSize(undefined)).toBe(85);
    expect(captionFontSize(-10)).toBe(0);
    expect(captionFontSize(143)).toBe(143);
    expect(captionFontSize(260)).toBe(200);
  });

  it("migrates only the previous subtitle defaults", () => {
    expect(migrateCaptionDefaults({ fontSize: 75, lineHeight: 1.25, backgroundOpacity: .72, portraitOffset: 8 })).toEqual({ fontSize: 85, lineHeight: 1.52, backgroundOpacity: .5, portraitOffset: 12 });
    expect(migrateCaptionDefaults({ version: 2, lineHeight: 1.45 })).toEqual({ version: 2, lineHeight: 1.52 });
    expect(migrateCaptionDefaults({ version: 3, lineHeight: 1.53 })).toEqual({ version: 3, lineHeight: 1.52 });
    expect(migrateCaptionDefaults({ fontSize: 90, lineHeight: 1.4, backgroundOpacity: .4, portraitOffset: 18 })).toEqual({ fontSize: 90, lineHeight: 1.4, backgroundOpacity: .4, portraitOffset: 18 });
    expect(migrateCaptionDefaults({ version: captionPrefsVersion, fontSize: 75, lineHeight: 1.25, backgroundOpacity: .72, portraitOffset: 8 })).toEqual({ version: captionPrefsVersion, fontSize: 75, lineHeight: 1.25, backgroundOpacity: .72, portraitOffset: 8 });
  });

  it("clamps caption vertical offset to 0-30 percent", () => {
    expect(captionVerticalOffset(undefined)).toBe(8);
    expect(captionVerticalOffset(-10)).toBe(0);
    expect(captionVerticalOffset(12)).toBe(12);
    expect(captionVerticalOffset(45)).toBe(30);
  });

  it("keeps subtitle line height between 1.45 and 2", () => {
    expect(captionLineHeight(undefined)).toBe(1.52);
    expect(captionLineHeight(1.2)).toBe(1.45);
    expect(captionLineHeight(1.7)).toBe(1.7);
    expect(captionLineHeight(2.2)).toBe(2);
  });

  it("uses real standard shell fullscreen for touch-first devices when available", () => {
    expect(prefersViewportFullscreen(5, false)).toBe(true);
    expect(prefersViewportFullscreen(0, true)).toBe(true);
    expect(prefersViewportFullscreen(0, false)).toBe(false);
    expect(fullscreenStrategy(true, true, true)).toBe("standard-shell");
    expect(fullscreenStrategy(false, true, true)).toBe("viewport");
  });

  it("recognizes iPad Brave when it masks itself as desktop Apple WebKit", () => {
    const ipadBrave = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15 Brave";
    const desktopSafari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15";
    const desktopChrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
    const desktopFirefox = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0";
    expect(prefersViewportFullscreen(0, false, ipadBrave)).toBe(true);
    expect(prefersViewportFullscreen(0, false, desktopSafari)).toBe(false);
    expect(prefersViewportFullscreen(0, false, desktopChrome)).toBe(false);
    expect(prefersViewportFullscreen(0, false, desktopFirefox)).toBe(false);
  });

  it("never uses legacy WebKit fullscreen on Apple touch clients", () => {
    expect(fullscreenStrategy(false, true, true)).toBe("viewport");
    expect(fullscreenStrategy(false, true, false)).toBe("legacy-shell");
    expect(fullscreenStrategy(true, true, false)).toBe("standard-shell");
  });

  it("explains that direct AirPlay on a Mac requires Safari", () => {
    expect(airPlayNoticeDurationMs).toBe(5_000);
    expect(airPlayUnavailableMessage("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140 Safari/537.36"))
      .toBe("Direct AirPlay requires Safari on this Mac. Open this page in Safari or use Screen Mirroring.");
    expect(airPlayUnavailableMessage("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140 Safari/537.36"))
      .toBe("AirPlay is not available in this browser.");
  });

  it("enters pause cinema only after ten seconds and leaves immediately", () => {
    expect(pauseCinemaVisible(true, 9_999)).toBe(false);
    expect(pauseCinemaVisible(true, 10_000)).toBe(true);
    expect(pauseCinemaVisible(false, 30_000)).toBe(false);
  });

  it("clears the playing title after seven seconds without letting mouse jitter extend it", () => {
    expect(titleDisplayDurationMs).toBe(7_000);
    expect(shouldArmTitleTimer(false)).toBe(true);
    expect(shouldArmTitleTimer(true)).toBe(false);
  });

  it("starts pause cinema copy after the corner-title handoff, then spaces entrances seven tenths apart", () => {
    expect(pauseCinemaDelays(false)).toEqual({ title: .62, year: 1.32, synopsis: 2.02 });
    expect(pauseCinemaDelays(true)).toEqual({ title: .62, year: 1.32, episode: 2.02, synopsis: 2.72 });
    expect(pauseSynopsisDurationSeconds).toBe(1.05);
  });

  it("recognizes space and K across modern and legacy keyboard event values", () => {
    expect(isPlaybackToggleKey(" ", "Space")).toBe(true);
    expect(isPlaybackToggleKey("Spacebar", "Space")).toBe(true);
    expect(isPlaybackToggleKey("Unidentified", "Space")).toBe(true);
    expect(isPlaybackToggleKey("k", "KeyK")).toBe(true);
    expect(isPlaybackToggleKey("j", "KeyJ")).toBe(false);
  });

  it("normalizes every player shortcut from either key or hardware code", () => {
    expect(playerKeyboardAction("ArrowLeft", "ArrowLeft")).toBe("seek-back");
    expect(playerKeyboardAction("Unidentified", "ArrowRight")).toBe("seek-forward");
    expect(playerKeyboardAction("j", "KeyJ")).toBe("seek-back");
    expect(playerKeyboardAction("Unidentified", "KeyL")).toBe("seek-forward");
    expect(playerKeyboardAction("ArrowUp", "ArrowUp")).toBe("volume-up");
    expect(playerKeyboardAction("Unidentified", "ArrowDown")).toBe("volume-down");
    expect(playerKeyboardAction("m", "KeyM")).toBe("mute");
    expect(playerKeyboardAction("c", "KeyC")).toBe("captions");
    expect(playerKeyboardAction("f", "KeyF")).toBe("fullscreen");
    expect(playerKeyboardAction("x", "KeyX")).toBeNull();
  });

  it("keeps the corner title still during the pause-screen crossfade, then hands off", () => {
    expect(playerTitleOwners(false, true)).toEqual({ corner: true, pause: false });
    expect(playerTitleOwners(true, true, true)).toEqual({ corner: true, pause: true });
    expect(playerTitleOwners(true, false)).toEqual({ corner: false, pause: true });
  });

  it("enters picture in picture only for actively playing, loaded video", () => {
    expect(shouldAutoPictureInPicture(false, false, 2)).toBe(true);
    expect(shouldAutoPictureInPicture(true, false, 4)).toBe(false);
    expect(shouldAutoPictureInPicture(false, true, 4)).toBe(false);
    expect(shouldAutoPictureInPicture(false, false, 1)).toBe(false);
  });

  it("formats real playback diagnostics without inventing unavailable values", () => {
    expect(formatPlaybackStats({
      width: 1920,
      height: 1080,
      mode: "Direct play",
      container: "mkv",
      videoCodec: "hevc",
      videoProfile: "Main 10",
      bitDepth: 10,
      frameRate: 23.976,
      videoBitrate: 7_850_000,
      audioCodec: "aac",
      audioChannels: 6,
      sampleRate: 48_000,
      audioBitrate: 384_000,
      position: 125.2,
      duration: 6_398.3,
      bufferedSeconds: 18.46,
      droppedFrames: 3,
      totalFrames: 2400,
      viewportWidth: 1366,
      viewportHeight: 768,
      readyState: 4,
      networkState: 1,
      bandwidth: 24_500_000,
      hlsLevel: "1920 × 1080 · 8.2 Mbps",
      rate: 1.25,
    })).toEqual([
      ["Resolution", "1920 × 1080"],
      ["Player", "1366 × 768"],
      ["Playback", "Direct play"],
      ["Container", "MKV"],
      ["Video", "HEVC · Main 10 · 10-bit"],
      ["Frame rate", "23.976 fps"],
      ["Video bitrate", "7.85 Mbps"],
      ["Audio", "AAC · 6 ch · 48 kHz"],
      ["Audio bitrate", "384 kbps"],
      ["Position", "02:05 / 1:46:38"],
      ["Buffer", "18.5 s"],
      ["Frames", "3 dropped / 2,400"],
      ["HLS level", "1920 × 1080 · 8.2 Mbps"],
      ["Bandwidth", "24.50 Mbps"],
      ["Media state", "Ready · Idle"],
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
    expect(subtitleTrackLabel({ Index: 6, Title: "GalaxyRG", Language: "eng" })).toBe("English");
    expect(subtitleTrackLabel({ Index: 7, DisplayTitle: "GalaxyRG / Chinese Traditional / PGS" })).toBe("Chinese Traditional");
    expect(subtitleTrackLabel({ Index: 8, DisplayTitle: "English SDH - SUBRIP - External" })).toBe("English (SDH)");
    expect(subtitleTrackLabel({ Index: 9, DisplayTitle: "English Forced - SRT" })).toBe("English (Forced)");
  });

  it("replaces Jellyfin's undefined language placeholder with a human label", () => {
    expect(subtitleTrackLabel({ Index: 0, DisplayTitle: "Undefined - SUBRIP - External" })).toBe("Subtitle track 1");
    expect(subtitleTrackLabel({ Index: 2, Language: "und" })).toBe("Subtitle track 3");
    expect(subtitleTrackLabel({ Index: 4, Title: "GalaxyRG" })).toBe("Subtitle track 5");
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
