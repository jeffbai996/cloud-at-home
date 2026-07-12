export type ScoreKind = "community" | "critic";
export type CountryPresentation = { code?: string; label: string };

const countries: Record<string, CountryPresentation> = {
  us: { code: "US", label: "United States of America" }, usa: { code: "US", label: "United States of America" },
  "united states": { code: "US", label: "United States of America" }, "united states of america": { code: "US", label: "United States of America" },
  ca: { code: "CA", label: "Canada" }, canada: { code: "CA", label: "Canada" },
  gb: { code: "GB", label: "United Kingdom" }, uk: { code: "GB", label: "United Kingdom" }, "united kingdom": { code: "GB", label: "United Kingdom" },
  cn: { code: "CN", label: "China" }, china: { code: "CN", label: "China" }, hk: { code: "HK", label: "Hong Kong" }, "hong kong": { code: "HK", label: "Hong Kong" },
  jp: { code: "JP", label: "Japan" }, japan: { code: "JP", label: "Japan" }, kr: { code: "KR", label: "South Korea" }, "south korea": { code: "KR", label: "South Korea" },
  fr: { code: "FR", label: "France" }, france: { code: "FR", label: "France" }, de: { code: "DE", label: "Germany" }, germany: { code: "DE", label: "Germany" },
  au: { code: "AU", label: "Australia" }, australia: { code: "AU", label: "Australia" },
};

export function countryPresentation(value?: string): CountryPresentation | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return countries[normalized.toLowerCase()] ?? { label: normalized };
}

export function scoreSource(kind: ScoreKind, providerIds?: Record<string, string>): { label: string; description: string; href?: string } {
  if (kind === "community") {
    const id = providerIds?.Imdb?.trim();
    return { label: "IMDb rating", description: "IMDb's weighted average of ratings submitted by registered users.", href: id && /^tt\d+$/.test(id) ? `https://www.imdb.com/title/${id}/` : undefined };
  }
  const id = providerIds?.RottenTomatoes?.trim().replace(/^\/+/, "");
  return { label: "Tomatometer", description: "The share of approved critics' reviews rated positive by Rotten Tomatoes.", href: id && /^(m|tv)\/[a-z0-9_-]+$/i.test(id) ? `https://www.rottentomatoes.com/${id}` : undefined };
}
