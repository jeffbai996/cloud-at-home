import { describe, expect, it } from "vitest";

import { countryPills, countryPresentation, productionDetails, scoreSource, seriesCardMeta, seriesYearRange, studioLabel } from "./mediaMetadata";

describe("countryPresentation", () => {
  it.each([
    ["US", { code: "US", label: "United States" }],
    ["United States", { code: "US", label: "United States" }],
    ["United States of America", { code: "US", label: "United States" }],
    ["Canada", { code: "CA", label: "Canada" }],
    ["United Kingdom", { code: "GB", label: "United Kingdom" }],
  ])("normalizes %s for its expandable country pill", (value, expected) => {
    expect(countryPresentation(value)).toEqual(expected);
  });

  it("keeps an unknown country label and uses a generic flag", () => {
    expect(countryPresentation("Exampleland")).toEqual({ code: undefined, label: "Exampleland" });
  });
});

describe("studioLabel", () => {
  it("shortens Walt Disney Animation for the compact details pill", () => {
    expect(studioLabel("Walt Disney Animation Studios")).toBe("Disney");
  });

  it("keeps other studio names unchanged", () => {
    expect(studioLabel("Pixar Animation Studios")).toBe("Pixar Animation Studios");
  });
});

describe("scoreSource", () => {
  it("builds a canonical IMDb title link from Jellyfin provider metadata", () => {
    expect(scoreSource("community", { Imdb: "tt1375666" })).toMatchObject({
      label: "IMDb rating",
      href: "https://www.imdb.com/title/tt1375666/",
    });
  });

  it("uses a Rotten Tomatoes title id when the provider supplies one", () => {
    expect(scoreSource("critic", { RottenTomatoes: "m/example_movie" })).toMatchObject({
      label: "Tomatometer",
      href: "https://www.rottentomatoes.com/m/example_movie",
    });
  });

  it("does not invent a title link when Jellyfin has no provider id", () => {
    expect(scoreSource("critic", undefined).href).toBeUndefined();
  });
});

describe("productionDetails", () => {
  it("uses every production field exposed by Jellyfin", () => {
    expect(productionDetails({
      ProductionLocations: ["United States of America", "Canada"],
      Studios: [{ Name: "Example Pictures" }, { Name: "North Shore Films" }],
      PremiereDate: "2024-07-12T00:00:00.000Z",
      ProductionYear: 2024,
    })).toEqual([
      { label: "Countries of production", value: "United States · Canada" },
      { label: "Production companies", value: "Example Pictures · North Shore Films" },
      { label: "Original release", value: "July 12, 2024" },
    ]);
  });

  it("gracefully omits missing details and falls back to production year", () => {
    expect(productionDetails({ ProductionLocations: ["Japan"], ProductionYear: 2021 })).toEqual([
      { label: "Country of production", value: "Japan" },
      { label: "Original release", value: "2021" },
    ]);
  });
});


describe("countryPills", () => {
  it("surfaces United States first when it is a co-production country", () => {
    expect(countryPills(["Switzerland", "United States of America"])).toEqual({
      pills: [
        { code: "US", label: "United States" },
        { code: undefined, label: "Switzerland" },
      ],
      overflow: [],
    });
  });

  it("keeps co-production order after US and dedupes", () => {
    expect(countryPills(["Canada", "United Kingdom", "United States of America"])).toEqual({
      pills: [
        { code: "US", label: "United States" },
        { code: "CA", label: "Canada" },
      ],
      overflow: [{ code: "GB", label: "United Kingdom" }],
    });
  });

  it("caps at two pills and pushes the rest to overflow without losing them", () => {
    const result = countryPills(["Czech Republic", "France", "United States of America", "United Kingdom"]);
    expect(result.pills).toEqual([
      { code: "US", label: "United States" },
      { code: undefined, label: "Czech Republic" },
    ]);
    expect(result.overflow).toEqual([
      { code: "FR", label: "France" },
      { code: "GB", label: "United Kingdom" },
    ]);
  });

  it("leaves the order intact when there is no US involvement", () => {
    expect(countryPills(["France", "Germany"]).pills).toEqual([
      { code: "FR", label: "France" },
      { code: "DE", label: "Germany" },
    ]);
  });

  it("returns nothing for an empty or missing location list", () => {
    expect(countryPills(undefined)).toEqual({ pills: [], overflow: [] });
    expect(countryPills([])).toEqual({ pills: [], overflow: [] });
  });
});


describe("seriesYearRange", () => {
  it("shows a full closed range for an ended multi-year series", () => {
    expect(seriesYearRange({ ProductionYear: 2016, EndDate: "2023-10-29T00:00:00.000Z", Status: "Ended" }))
      .toBe("2016 \u2013 2023");
  });

  it("abbreviates the end year to two digits for the compact card", () => {
    expect(seriesYearRange({ ProductionYear: 2016, EndDate: "2023-10-29T00:00:00.000Z", Status: "Ended" }, { abbreviate: true }))
      .toBe("2016 \u2013 23");
  });

  it("leaves the range open for a continuing series", () => {
    expect(seriesYearRange({ ProductionYear: 2023, EndDate: "2025-05-25T00:00:00.000Z", Status: "Continuing" }))
      .toBe("2023 \u2013");
  });

  it("collapses to a single year when a series began and ended the same year", () => {
    expect(seriesYearRange({ ProductionYear: 2019, EndDate: "2019-06-03T00:00:00.000Z", Status: "Ended" }))
      .toBe("2019");
  });

  it("falls back to just the start year when no end date is known", () => {
    expect(seriesYearRange({ ProductionYear: 2016 })).toBe("2016");
  });
});

describe("seriesCardMeta", () => {
  it("joins the year range and a pluralized season count", () => {
    expect(seriesCardMeta({ ProductionYear: 2016, EndDate: "2023-10-29T00:00:00.000Z", Status: "Ended", ChildCount: 6 }))
      .toBe("2016 \u2013 23 \u00b7 6 Seasons");
  });

  it("uses the singular for a one-season series and keeps a continuing range open", () => {
    expect(seriesCardMeta({ ProductionYear: 2023, EndDate: "2025-05-25T00:00:00.000Z", Status: "Continuing", ChildCount: 1 }))
      .toBe("2023 \u2013 \u00b7 1 Season");
  });

  it("omits the season count when it is unknown", () => {
    expect(seriesCardMeta({ ProductionYear: 2019 })).toBe("2019");
  });
});


