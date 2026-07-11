import { describe, expect, it } from "vitest";

import { ratingBadge } from "./rating";

describe("ratingBadge", () => {
  it.each([
    ["CA-G", { label: "G", scheme: "ca", shape: "circle", tone: "green" }],
    ["CA-PG", { label: "PG", scheme: "ca", shape: "rounded", tone: "yellow" }],
    ["CA-14A", { label: "14A", scheme: "ca", shape: "hex", tone: "blue" }],
    ["CA-18A", { label: "18A", scheme: "ca", shape: "triangle", tone: "orange" }],
    ["CA-R", { label: "R", scheme: "ca", shape: "circle", tone: "red" }],
    ["CA-A", { label: "A", scheme: "ca", shape: "circle", tone: "red" }],
    ["TV-PG", { label: "TV-PG", scheme: "us-tv", shape: "plaque", tone: "mono" }],
    ["PG-13", { label: "PG-13", scheme: "us-film", shape: "plaque", tone: "mono" }],
  ] as const)("maps %s to its visual badge", (rating, expected) => {
    expect(ratingBadge(rating)).toMatchObject(expected);
  });

  it("preserves unknown library ratings without pretending they are official artwork", () => {
    expect(ratingBadge("DE-12")).toEqual({
      label: "DE-12",
      scheme: "plain",
      shape: "plaque",
      tone: "mono",
      ariaLabel: "Rated DE-12",
      name: "DE-12",
      authority: "Media library",
      description: "No classification guidance is available for this rating.",
      authorityUrl: undefined,
    });
  });

  it.each(["CA-14+", "CA-18+"])("presents %s as Canadian television guidance rather than a B.C. film classification", (rating) => {
    expect(ratingBadge(rating)).toMatchObject({ scheme: "ca-tv", authority: "Canadian Broadcast Standards Council" });
  });

  it.each([
    ["CA-G", "General", "British Columbia Film Classification Office", "Suitable for viewers of all ages."],
    ["CA-14A", "14 Accompaniment", "British Columbia Film Classification Office", "Viewers under 14 years of age must be accompanied by an adult."],
    ["CA-18A", "18 Accompaniment", "British Columbia Film Classification Office", "Viewers under 18 years of age must be accompanied by an adult."],
    ["CA-R", "Restricted", "British Columbia Film Classification Office", "under 18 years of age are not permitted"],
    ["CA-A", "Adult", "British Columbia Film Classification Office", "under 18 years of age are not permitted"],
    ["TV-MA", "Mature Audience Only", "TV Parental Guidelines", "unsuitable for children under 17"],
    ["PG-13", "Parents Strongly Cautioned", "Motion Picture Association of America", "inappropriate for children under 13"],
  ])("includes official classification guidance for %s", (rating, name, authority, copy) => {
    expect(ratingBadge(rating)).toMatchObject({ name, authority });
    expect(ratingBadge(rating).description).toContain(copy);
    expect(ratingBadge(rating).authorityUrl).toMatch(/^https:\/\//);
  });
});
