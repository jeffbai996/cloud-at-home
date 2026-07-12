import { describe, expect, it } from "vitest";
import { countryPresentation, scoreSource } from "./mediaMetadata";

describe("countryPresentation", () => {
  it.each([
    ["US", { code: "US", label: "United States of America" }],
    ["United States", { code: "US", label: "United States of America" }],
    ["Canada", { code: "CA", label: "Canada" }],
    ["United Kingdom", { code: "GB", label: "United Kingdom" }],
  ])("normalizes %s for its expandable country pill", (value, expected) => expect(countryPresentation(value)).toEqual(expected));
  it("keeps an unknown country label", () => expect(countryPresentation("Exampleland")).toEqual({ code: undefined, label: "Exampleland" }));
});

describe("scoreSource", () => {
  it("builds a canonical IMDb title link", () => expect(scoreSource("community", { Imdb: "tt1375666" })).toMatchObject({ label: "IMDb rating", href: "https://www.imdb.com/title/tt1375666/" }));
  it("uses a Rotten Tomatoes title id", () => expect(scoreSource("critic", { RottenTomatoes: "m/example_movie" })).toMatchObject({ label: "Tomatometer", href: "https://www.rottentomatoes.com/m/example_movie" }));
  it("does not invent a title link", () => expect(scoreSource("critic", undefined).href).toBeUndefined());
});
