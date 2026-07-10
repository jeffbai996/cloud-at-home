import { describe, expect, it } from "vitest";

import { editorModeFor, joinPath } from "./file-utils";

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
});
