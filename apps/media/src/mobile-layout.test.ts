import { describe, expect, it } from "vitest";
// @ts-expect-error -- Vitest runs this test in Node; the browser package intentionally omits Node type declarations.
import { readFileSync } from "node:fs";

const mediaCss = readFileSync(new URL("./media.css", import.meta.url), "utf8");

describe("mobile media header", () => {
  it("keeps the media brand mark visible at iPhone widths", () => {
    expect(mediaCss).not.toMatch(/@media \(max-width: 520px\)[\s\S]*?\.brand-mark-media\s*\{[^}]*display:\s*none/);
    expect(mediaCss).toMatch(/@media \(max-width: 520px\)[\s\S]*?\.app-media \.brand\s*\{[^}]*font-size:\s*17px/);
    expect(mediaCss).toMatch(/@media \(max-width: 520px\)[\s\S]*?\.timecode-total\s*\{[^}]*display:\s*none/);
  });
});
