import { describe, expect, it } from "vitest";

import { editorModeFor, exactTimestamp, extensionFor, isTextFile, joinPath, languageForFile, relativeTimestamp, togglePath, viewerKindFor } from "./file-utils";

describe("file utilities", () => {
  it("joins paths without producing traversal or duplicate slashes", () => {
    expect(joinPath("/TV Shows/", "/Example.mkv")).toBe("/TV Shows/Example.mkv");
    expect(() => joinPath("/TV Shows", "../secret")).toThrow();
  });

  it("enforces editor size boundaries", () => {
    expect(editorModeFor(5 * 1024 * 1024)).toBe("edit");
    expect(editorModeFor(5 * 1024 * 1024 + 1)).toBe("read");
    expect(editorModeFor(50 * 1024 * 1024 + 1)).toBe("download");
  });

  it("recognizes source, config, subtitle, and extensionless power-user files", () => {
    expect(languageForFile("Dockerfile")).toBe("dockerfile");
    expect(languageForFile("Makefile")).toBe("makefile");
    expect(languageForFile("component.tsx")).toBe("typescript");
    expect(languageForFile("captions.zh-Hans.srt")).toBe("srt");
    expect(extensionFor(".editorconfig")).toBe(".editorconfig");
    expect(isTextFile("schema.proto")).toBe(true);
    expect(isTextFile("archive.zip", "application/zip")).toBe(false);
  });

  it("routes common browser-readable formats to the right viewer", () => {
    expect(viewerKindFor("photo.avif")).toBe("image");
    expect(viewerKindFor("movie.mkv")).toBe("video");
    expect(viewerKindFor("audio.opus")).toBe("audio");
    expect(viewerKindFor("manual.pdf")).toBe("pdf");
    expect(viewerKindFor("README.md")).toBe("markdown");
    expect(viewerKindFor("report.html")).toBe("html");
    expect(viewerKindFor("bundle.zip")).toBe("download");
  });

  it("adds and removes quick access paths without duplicates", () => {
    expect(togglePath(["/Documents"], "/Downloads")).toEqual(["/Documents", "/Downloads"]);
    expect(togglePath(["/Documents", "/Downloads"], "/Documents")).toEqual(["/Downloads"]);
  });

  it("summarizes recent modified times without hiding the exact timestamp", () => {
    const now = new Date("2026-07-11T12:00:00").valueOf();
    expect(relativeTimestamp("2026-07-11T11:55:00", now, "en-US")).toBe("5m ago");
    expect(relativeTimestamp("2026-07-11T09:00:00", now, "en-US")).toBe("3h ago");
    expect(relativeTimestamp("2026-07-08T12:00:00", now, "en-US")).toBe("3d ago");
    expect(exactTimestamp("2026-07-11T01:30:00", "en-US")).toContain("Jul 11, 2026");
  });

  it("handles missing or malformed modified times", () => {
    expect(relativeTimestamp("", Date.now(), "en-US")).toBe("Unavailable");
    expect(relativeTimestamp("not-a-date", Date.now(), "en-US")).toBe("Unavailable");
    expect(exactTimestamp("not-a-date", "en-US")).toBe("Unavailable");
  });
});
