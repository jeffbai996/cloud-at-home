import { describe, expect, it } from "vitest";

import { captionSizeFlash, shortcutFlash, activeCaptionPreset, activeCueText, airPlayNoticeDurationMs, airPlayUnavailableMessage, captionFontSize, captionLineHeight, captionPrefsVersion, captionSizePreset, captionVerticalOffset, classifyStat, formatPlaybackStats, fullscreenStrategy, isPlaybackToggleKey, isResumable, mediaYearLabel, migrateCaptionDefaults, pauseCinemaDelays, pauseCinemaVisible, pauseSynopsisDurationSeconds, playbackStartPosition, playerKeyboardAction, playerTitleOwners, prefersViewportFullscreen, progressEvents, resumePosition, seekTime, shouldArmTitleTimer, shouldAutoPictureInPicture, shouldReportProgress, subtitleTrackLabel, titleDisplayDurationMs, trickplayFrame, webPlaybackProfile, webPlaybackProfileFor } from "./playback";

describe("web playback capabilities", () => {
  it("never offers progressive direct play — every video flows as bounded HLS segments", () => {
    // Direct play = the whole file as ONE unbounded request through the
    // gateway's sync worker pool; paused/slept clients pinned workers until
    // the pool starved (2026-07-26 outage). Segment streaming is the fix,
    // not a preference.
    expect(webPlaybackProfile.DirectPlayProfiles).toEqual([]);
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

  it("offers fMP4 HLS stream-copy only when the browser reports HEVC support", () => {
    expect(webPlaybackProfileFor(false).DirectPlayProfiles).toEqual([]);
    // "hls" direct play is segment streaming (bounded) — the only direct
    // container allowed; no progressive mp4/m4v profile may reappear.
    expect(webPlaybackProfileFor(true).DirectPlayProfiles).toEqual([
      expect.objectContaining({ Container: "hls", VideoCodec: "hevc,h264" }),
    ]);
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
    expect(migrateCaptionDefaults({ fontSize: 75, lineHeight: 1.25, backgroundOpacity: .72, portraitOffset: 8 })).toEqual({ fontSize: 85, lineHeight: 1.49, backgroundOpacity: .5, portraitOffset: 12 });
    expect(migrateCaptionDefaults({ version: 2, lineHeight: 1.45 })).toEqual({ version: 2, lineHeight: 1.49 });
    expect(migrateCaptionDefaults({ version: 3, lineHeight: 1.53 })).toEqual({ version: 3, lineHeight: 1.49 });
    expect(migrateCaptionDefaults({ version: 4, lineHeight: 1.52 })).toEqual({ version: 4, lineHeight: 1.49 });
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
    expect(captionLineHeight(undefined)).toBe(1.49);
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

describe("caption size presets", () => {
  it("maps preset names to font-size percentages", () => {
    expect(captionSizePreset("small")).toBe(65);
    expect(captionSizePreset("default")).toBe(85);
    expect(captionSizePreset("large")).toBe(120);
  });

  it("falls back to the default size for an unknown preset", () => {
    expect(captionSizePreset("gigantic")).toBe(85);
  });

  it("identifies which preset an exact font size belongs to", () => {
    expect(activeCaptionPreset(65)).toBe("small");
    expect(activeCaptionPreset(85)).toBe("default");
    expect(activeCaptionPreset(120)).toBe("large");
  });

  it("returns null when the font size is a custom (non-preset) value", () => {
    expect(activeCaptionPreset(92)).toBeNull();
    expect(activeCaptionPreset(0)).toBeNull();
  });
});

describe("stat severity classification", () => {
  it("flags direct playback as good and transcoded playback as a warning", () => {
    expect(classifyStat("Playback", "Direct")).toBe("good");
    expect(classifyStat("Playback", "Transcode (HLS)")).toBe("warn");
    expect(classifyStat("Playback", "Remux")).toBe("warn");
  });

  it("flags zero dropped frames as good and any drops as a warning", () => {
    expect(classifyStat("Frames", "0 dropped / 143,220")).toBe("good");
    expect(classifyStat("Frames", "12 dropped / 143,220")).toBe("warn");
  });

  it("treats descriptive stats as neutral", () => {
    expect(classifyStat("Resolution", "1920 × 1080")).toBe("neutral");
    expect(classifyStat("Video bitrate", "8.4 Mbps")).toBe("neutral");
    expect(classifyStat("Speed", "1×")).toBe("neutral");
  });
});

describe("shortcut flash", () => {
  it("gives play and pause opposite glyphs so the new state is what is shown", () => {
    // The flash reports the state the key produced, not the one it left.
    expect(shortcutFlash("toggle", { paused: false })).toMatchObject({ icon: "play" });
    expect(shortcutFlash("toggle", { paused: true })).toMatchObject({ icon: "pause" });
  });

  it("labels seeks with their step and direction", () => {
    expect(shortcutFlash("seek-forward", {})).toMatchObject({ icon: "forward", label: "10s" });
    expect(shortcutFlash("seek-back", {})).toMatchObject({ icon: "backward", label: "10s" });
  });

  it("moves exactly ten seconds and clamps at media boundaries", () => {
    expect(seekTime(47.25, 10, 100)).toBe(57.25);
    expect(seekTime(47.25, -10, 100)).toBe(37.25);
    expect(seekTime(96, 10, 100)).toBe(100);
    expect(seekTime(4, -10, 100)).toBe(0);
  });

  it("shows the resulting volume as a whole percentage", () => {
    expect(shortcutFlash("volume-up", { volume: 0.55 })).toMatchObject({ icon: "volume", label: "55%" });
    expect(shortcutFlash("volume-down", { volume: 0.05 })).toMatchObject({ icon: "volume-low", label: "5%" });
    expect(shortcutFlash("volume-up", { volume: 1 })).toMatchObject({ label: "100%" });
    // the player boosts past unity via a gain node -- don't clamp it to 100%
    expect(shortcutFlash("volume-up", { volume: 1.5 })).toMatchObject({ label: "150%" });
  });

  it("uses the muted glyph at zero volume even when not explicitly muted", () => {
    expect(shortcutFlash("volume-down", { volume: 0 })).toMatchObject({ icon: "volume-muted", label: "0%" });
  });

  it("reports mute state rather than the key that toggled it", () => {
    expect(shortcutFlash("mute", { muted: true })).toMatchObject({ icon: "volume-muted", label: "Muted" });
    // unmuting restores the level glyph for wherever the volume actually sits
    expect(shortcutFlash("mute", { muted: false, volume: 0.4 })).toMatchObject({ icon: "volume-low", label: "40%" });
    expect(shortcutFlash("mute", { muted: false, volume: 0.8 })).toMatchObject({ icon: "volume", label: "80%" });
  });

  it("reports whether captions ended up on or off", () => {
    expect(shortcutFlash("captions", { captionsActive: true })).toMatchObject({ icon: "captions", label: "On" });
    expect(shortcutFlash("captions", { captionsActive: false })).toMatchObject({ icon: "captions-off", label: "Off" });
  });

  it("skips actions whose result is already obvious on screen", () => {
    // Fullscreen visibly resizes the viewport; a badge saying so is noise.
    expect(shortcutFlash("fullscreen", {})).toBeNull();
  });

  it("shows caption size changes as a percentage", () => {
    expect(captionSizeFlash(90)).toMatchObject({ icon: "captions", label: "90%" });
  });
});
