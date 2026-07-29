import { describe, expect, it } from "vitest";

import {
  PHOTOS_ROOT,
  albumsFromResource,
  driveEntriesFromResource,
  fullUrl,
  isIngestibleMedia,
  monthGroups,
  listPhotosRecursive,
  photosFromResource,
  previewUrl,
  thumbUrl,
  type Photo,
} from "./api";

const photo = (overrides: Partial<Photo> = {}): Photo => ({
  path: "/photos/img.jpg",
  name: "img.jpg",
  date: "2026-07-01T10:00:00Z",
  kind: "image",
  ...overrides,
});

describe("preview and raw URLs", () => {
  it("builds gateway preview paths with per-segment encoding", () => {
    const item = photo({ path: "/photos/爸爸 2026/img 1.jpg" });
    expect(thumbUrl(item)).toBe(
      "/api/photos/proxy/preview/thumb/photos/%E7%88%B8%E7%88%B8%202026/img%201.jpg");
    expect(previewUrl(item)).toBe(
      "/api/photos/proxy/preview/big/photos/%E7%88%B8%E7%88%B8%202026/img%201.jpg");
  });

  it("serves originals through the raw route inline", () => {
    expect(fullUrl(photo())).toBe("/api/photos/proxy/raw/photos/img.jpg?inline=true");
  });
});

describe("photosFromResource", () => {
  const resource = {
    items: [
      { name: "old.jpg", path: "/photos/old.jpg", isDir: false, size: 10, modified: "2026-05-02T00:00:00Z" },
      { name: "new.HEIC", path: "/photos/new.HEIC", isDir: false, size: 10, modified: "2026-07-20T00:00:00Z" },
      { name: "clip.mov", path: "/photos/clip.mov", isDir: false, size: 10, modified: "2026-06-11T00:00:00Z" },
      { name: "notes.txt", path: "/photos/notes.txt", isDir: false, size: 10, modified: "2026-07-21T00:00:00Z" },
      { name: "sub", path: "/photos/sub", isDir: true, size: 0, modified: "2026-07-22T00:00:00Z" },
    ],
  };

  it("keeps only media files, newest first, with kinds", () => {
    const photos = photosFromResource(resource);
    expect(photos.map((p) => p.name)).toEqual(["new.HEIC", "clip.mov", "old.jpg"]);
    expect(photos[0].kind).toBe("image");
    expect(photos[1].kind).toBe("video");
  });

  it("canonicalizes FileBrowser child paths against the listed album", () => {
    const photos = photosFromResource({
      items: [
        { name: "photo.jpg", path: "/photo.jpg", isDir: false, size: 10, modified: "2026-07-20T00:00:00Z" },
      ],
    }, "/photos/trip");
    expect(photos[0].path).toBe("/photos/trip/photo.jpg");
  });
});

describe("listPhotosRecursive", () => {
  it("aggregates nested albums with canonical paths and newest-first order", async () => {
    const resources = new Map<string, {
      items: { name: string; isDir: boolean; size: number; modified: string }[];
    }>([
      ["/photos", { items: [
        { name: "root.jpg", isDir: false, size: 1, modified: "2026-07-01T00:00:00Z" },
        { name: "family", isDir: true, size: 0, modified: "2026-07-01T00:00:00Z" },
      ] }],
      ["/photos/family", { items: [
        { name: "new.jpg", isDir: false, size: 1, modified: "2026-07-20T00:00:00Z" },
        { name: "nested", isDir: true, size: 0, modified: "2026-07-01T00:00:00Z" },
      ] }],
      ["/photos/family/nested", { items: [
        { name: "clip.mov", isDir: false, size: 1, modified: "2026-07-10T00:00:00Z" },
      ] }],
    ]);

    const photos = await listPhotosRecursive("/photos", async (path) => {
      const resource = resources.get(path);
      if (!resource) throw new Error(`missing ${path}`);
      return resource;
    });

    expect(photos.map((item) => item.path)).toEqual([
      "/photos/family/new.jpg",
      "/photos/family/nested/clip.mov",
      "/photos/root.jpg",
    ]);
  });

  it("keeps readable folders when one nested album fails", async () => {
    const photos = await listPhotosRecursive("/photos", async (path) => {
      if (path === "/photos") return { items: [
        { name: "ok.jpg", isDir: false, size: 1, modified: "2026-07-01T00:00:00Z" },
        { name: "locked", isDir: true, size: 0, modified: "2026-07-01T00:00:00Z" },
      ] };
      throw new Error("forbidden");
    });
    expect(photos.map((item) => item.name)).toEqual(["ok.jpg"]);
  });
});

describe("ingestible media", () => {
  it("accepts Photos image and video formats but rejects unrelated files", () => {
    expect(isIngestibleMedia("portrait.HEIC")).toBe(true);
    expect(isIngestibleMedia("clip.mov")).toBe(true);
    expect(isIngestibleMedia("archive.zip")).toBe(false);
    expect(isIngestibleMedia("notes.txt")).toBe(false);
  });
});

describe("albumsFromResource", () => {
  it("lists subfolders as albums and ignores files", () => {
    const albums = albumsFromResource({
      items: [
        { name: "trip", path: "/photos/trip", isDir: true, size: 0, modified: "2026-07-01T00:00:00Z", numFiles: 4 },
        { name: "x.jpg", path: "/photos/x.jpg", isDir: false, size: 1, modified: "2026-07-01T00:00:00Z" },
      ],
    });
    expect(albums).toEqual([
      { path: "/photos/trip", name: "trip", count: 4, coverThumbUrl: null },
    ]);
  });

  it("canonicalizes album paths instead of trusting relative upstream paths", () => {
    const albums = albumsFromResource({
      items: [
        { name: "trip", path: "/trip", isDir: true, size: 0, modified: "2026-07-01T00:00:00Z" },
      ],
    }, "/photos");
    expect(albums[0].path).toBe("/photos/trip");
  });
});

describe("driveEntriesFromResource", () => {
  it("anchors nested Drive entries to the folder being browsed", () => {
    const entries = driveEntriesFromResource({
      items: [
        { name: "photo.jpg", path: "/photo.jpg", isDir: false, size: 1, modified: "2026-07-01T00:00:00Z" },
        { name: "notes.txt", path: "/notes.txt", isDir: false, size: 1, modified: "2026-07-01T00:00:00Z" },
      ],
    }, "/family/2026");
    expect(entries).toEqual([
      { name: "photo.jpg", path: "/family/2026/photo.jpg", isDir: false },
    ]);
  });
});

describe("monthGroups", () => {
  it("groups newest month first with readable labels", () => {
    const groups = monthGroups([
      photo({ name: "a.jpg", date: "2026-07-20T00:00:00Z" }),
      photo({ name: "b.jpg", date: "2026-07-02T00:00:00Z" }),
      photo({ name: "c.jpg", date: "2026-05-30T00:00:00Z" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["July 2026", "May 2026"]);
    expect(groups[0].photos.map((p) => p.name)).toEqual(["a.jpg", "b.jpg"]);
  });
});

describe("root scoping", () => {
  it("has a default root and never an absolute or empty one", () => {
    expect(PHOTOS_ROOT).toBe("photos");
  });
});

describe("importFromDrive", () => {
  it("copies into the album, collects failures, never aborts the batch", async () => {
    const calls: [string, string, boolean][] = [];
    const copy = async (from: string, to: string, isCopy: boolean) => {
      calls.push([from, to, isCopy]);
      if (from.includes("dup")) throw new Error("exists");
    };
    const { importFromDrive } = await import("./api");
    const result = await importFromDrive(
      ["/docs/a.jpg", "/docs/dup.jpg", "/docs/b.png"], "/photos/trip", copy);
    expect(result).toEqual({ done: 2, failed: ["dup.jpg: exists"] });
    expect(calls.map((c) => c[1])).toEqual(
      ["/photos/trip/a.jpg", "/photos/trip/dup.jpg", "/photos/trip/b.png"]);
    expect(calls.every((c) => c[2] === true)).toBe(true);
  });

  it("refuses a destination outside the photo library", async () => {
    const { importFromDrive } = await import("./api");
    await expect(importFromDrive(["/x.jpg"], "/documents"))
      .rejects.toThrow(/escapes the photo library/);
  });
});

describe("photo organization", () => {
  it("creates albums only inside the photo library", async () => {
    const { createAlbum } = await import("./api");
    const calls: string[] = [];
    await createAlbum("/photos", "Weekend", async (path) => { calls.push(path); });
    expect(calls).toEqual(["/photos/Weekend"]);
    await expect(createAlbum("/documents", "Nope")).rejects.toThrow(/escapes the photo library/);
    await expect(createAlbum("/photos", "../Nope")).rejects.toThrow(/valid album name/);
  });

  it("moves a selection independently and reports collisions", async () => {
    const { organizePhotos } = await import("./api");
    const calls: [string, string, boolean][] = [];
    const transform = async (from: string, to: string, copy: boolean) => {
      calls.push([from, to, copy]);
      if (from.endsWith("duplicate.jpg")) throw new Error("already exists");
    };
    const result = await organizePhotos([
      photo({ path: "/photos/a/one.jpg", name: "one.jpg" }),
      photo({ path: "/photos/b/duplicate.jpg", name: "duplicate.jpg" }),
    ], "/photos/Edited", false, transform);
    expect(result).toEqual({ done: 1, failed: ["duplicate.jpg: already exists"] });
    expect(calls).toEqual([
      ["/photos/a/one.jpg", "/photos/Edited/one.jpg", false],
      ["/photos/b/duplicate.jpg", "/photos/Edited/duplicate.jpg", false],
    ]);
  });
});
