import { describe, expect, it } from "vitest";

import { countryFlagPath } from "./countryFlags";

describe("countryFlagPath", () => {
  it.each(["US", "CA", "GB", "JP", "CN", "HK", "KR", "FR", "DE", "AU"])(
    "uses a maintained local vector for %s",
    (code) => expect(countryFlagPath(code)).toBe(`/flags/${code.toLowerCase()}.svg`),
  );

  it("falls back for countries without a bundled vector", () => {
    expect(countryFlagPath("ZZ")).toBeUndefined();
    expect(countryFlagPath(undefined)).toBeUndefined();
  });
});
