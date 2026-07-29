import { describe, expect, it } from "vitest";

import { editorModeFor, exactTimestamp, extensionFor, isTextFile, isUnderPhotosRoot, joinPath, languageForFile, mutationDestination, parentPath, photosDeepLink, relativeTimestamp, resourcePath, togglePath, viewerKindFor } from "./file-utils";

describe("file utilities", () => {
  it("joins paths without producing traversal or duplicate slashes", () => {
    expect(joinPath("/TV Shows/", "/Example.mkv")).toBe("/TV Shows/Example.mkv");
    expect(() => joinPath("/TV Shows", "../secret")).toThrow();
  });

  it("uses an item's absolute path rather than the current collection path", () => {
    const saved = { name: "budget.xlsx", path: "/Documents/Finance/budget.xlsx" };
    expect(resourcePath(saved, "/Downloads")).toBe("/Documents/Finance/budget.xlsx");
    expect(parentPath(saved.path)).toBe("/Documents/Finance");
    expect(mutationDestination("rename", saved.path, "budget-2026.xlsx")).toBe("/Documents/Finance/budget-2026.xlsx");
    expect(mutationDestination("move", saved.path, "/Archive")).toBe("/Archive/budget.xlsx");
    expect(mutationDestination("copy", saved.path, "/Archive")).toBe("/Archive/budget.xlsx");
  });

  it("keeps literal percent characters display-safe in paths", () => {
    expect(resourcePath({ name: "100% complete.txt" }, "/Downloads")).toBe("/Downloads/100% complete.txt");
    expect(parentPath("/100% complete.txt")).toBe("/");
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

describe("photos bridge", () => {
  it("knows which paths live inside the photo library", () => {
    expect(isUnderPhotosRoot("/photos/trip/a.jpg")).toBe(true);
    expect(isUnderPhotosRoot("photos/a.jpg")).toBe(true);
    expect(isUnderPhotosRoot("/photostudio/a.jpg")).toBe(false);
    expect(isUnderPhotosRoot("/documents/a.jpg")).toBe(false);
  });

  it("builds a photos deep link to the album with the item focused", () => {
    expect(photosDeepLink("https://host:8458", "/photos/trip/a.jpg")).toBe(
      "https://host:8458/#/album/photos%2Ftrip?item=a.jpg");
    expect(photosDeepLink("https://host:8458", "/photos/solo.jpg")).toBe(
      "https://host:8458/#/album/photos?item=solo.jpg");
  });
});
