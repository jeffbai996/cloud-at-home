import { describe, expect, it } from "vitest";

import { clampLightboxIndex, lightboxKindFor } from "./lightbox";

describe("lightboxKindFor", () => {
  it("classifies images, videos, and everything else", () => {
    expect(lightboxKindFor("a.JPG")).toBe("image");
    expect(lightboxKindFor("b.heic")).toBe("image");
    expect(lightboxKindFor("shot.avif")).toBe("image");
    expect(lightboxKindFor("c.mov")).toBe("video");
    expect(lightboxKindFor("clip.MP4")).toBe("video");
    expect(lightboxKindFor("d.pdf")).toBeNull();
    expect(lightboxKindFor("no-extension")).toBeNull();
  });
});

describe("clampLightboxIndex", () => {
  it("wraps navigation at both ends", () => {
    expect(clampLightboxIndex(3, 3)).toBe(0);
    expect(clampLightboxIndex(-1, 3)).toBe(2);
    expect(clampLightboxIndex(1, 3)).toBe(1);
  });

  it("stays at zero for an empty list", () => {
    expect(clampLightboxIndex(5, 0)).toBe(0);
  });
});
