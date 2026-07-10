import { describe, expect, it } from "vitest";

import mediaCss from "./media.css?raw";

describe("mobile media header", () => {
  it("keeps the media brand mark visible at iPhone widths", () => {
    const compactMediaQuery = mediaCss.match(/@media \(max-width: 520px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(compactMediaQuery).not.toMatch(/\.brand-mark-media\s*\{[^}]*display:\s*none/);
  });
});
