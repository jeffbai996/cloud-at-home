import { describe, expect, it } from "vitest";

import { countryFlagPath } from "./countryFlags";
import { mappedCountryCodes } from "./mediaMetadata";

describe("countryFlagPath", () => {
  it.each(["US", "CA", "GB", "JP", "CN", "HK", "KR", "FR", "DE", "AU", "CH", "NZ", "IN", "PL", "FI", "NL", "ES", "CZ", "ZA", "AR"])(
    "uses a maintained local vector for %s",
    (code) => expect(countryFlagPath(code)).toBe(`/flags/${code.toLowerCase()}.svg`),
  );

  // Guards against allowlist drift: a country added to the metadata map without
  // a bundled flag would render a flagless pill next to flagged neighbors.
  it.each(mappedCountryCodes)("bundles a flag for every mapped country (%s)", (code) => {
    expect(countryFlagPath(code)).toBeDefined();
  });

  it("falls back for countries without a bundled vector", () => {
    expect(countryFlagPath("ZZ")).toBeUndefined();
    expect(countryFlagPath(undefined)).toBeUndefined();
  });
});
