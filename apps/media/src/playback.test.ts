import { describe, expect, it } from "vitest";

import { activeCueText, progressEvents, resumePosition, shouldReportProgress, trickplayFrame } from "./playback";

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
});

describe("subtitle cues", () => {
  it("joins active cues, strips markup, and clears when no cue is active", () => {
    expect(activeCueText([{ text: "<i>Hello</i>" }, { text: "world" }])).toBe("Hello\nworld");
    expect(activeCueText([])).toBe("");
    expect(activeCueText(null)).toBe("");
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
