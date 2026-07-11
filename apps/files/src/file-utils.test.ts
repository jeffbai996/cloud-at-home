import { describe, expect, it } from "vitest";

import { editorModeFor, extensionFor, isTextFile, joinPath, languageForFile, viewerKindFor } from "./file-utils";

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
});
