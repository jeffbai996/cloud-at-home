export type ScoreKind = "community" | "critic";

export type CountryPresentation = { code?: string; label: string };
export type ProductionDetail = { label: string; value: string };
export type ProductionMetadata = {
  ProductionLocations?: string[];
  Studios?: Array<{ Name: string }>;
  PremiereDate?: string;
  ProductionYear?: number;
};

const countries: Record<string, CountryPresentation> = {
  us: { code: "US", label: "United States" },
  usa: { code: "US", label: "United States" },
  "united states": { code: "US", label: "United States" },
  "united states of america": { code: "US", label: "United States" },
  ca: { code: "CA", label: "Canada" },
  canada: { code: "CA", label: "Canada" },
  gb: { code: "GB", label: "United Kingdom" },
  uk: { code: "GB", label: "United Kingdom" },
  "united kingdom": { code: "GB", label: "United Kingdom" },
  cn: { code: "CN", label: "China" },
  china: { code: "CN", label: "China" },
  hk: { code: "HK", label: "Hong Kong" },
  "hong kong": { code: "HK", label: "Hong Kong" },
  jp: { code: "JP", label: "Japan" },
  japan: { code: "JP", label: "Japan" },
  kr: { code: "KR", label: "South Korea" },
  "south korea": { code: "KR", label: "South Korea" },
  fr: { code: "FR", label: "France" },
  france: { code: "FR", label: "France" },
  de: { code: "DE", label: "Germany" },
  germany: { code: "DE", label: "Germany" },
  au: { code: "AU", label: "Australia" },
  australia: { code: "AU", label: "Australia" },
};

export function countryPresentation(value?: string): CountryPresentation | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return countries[normalized.toLowerCase()] ?? { label: normalized };
}

export type CountryPills = { pills: CountryPresentation[]; overflow: CountryPresentation[] };

// TMDB lists co-production *financing* countries (why "Jobs" shows Switzerland),
// not where a film is from. Surface the US first when it's involved so obvious
// Hollywood titles read as United States, keep the real co-pros after it, and
// dedupe by resolved label. Split at `max` pills — the rest go to `overflow` so
// the hover card can still show every country (no information lost).
export function countryPills(locations?: string[], max = 2): CountryPills {
  const seen = new Set<string>();
  const resolved: CountryPresentation[] = [];
  for (const location of locations ?? []) {
    const country = countryPresentation(location);
    if (!country || seen.has(country.label)) continue;
    seen.add(country.label);
    resolved.push(country);
  }
  const ordered = resolved.some((country) => country.code === "US")
    ? [...resolved.filter((country) => country.code === "US"), ...resolved.filter((country) => country.code !== "US")]
    : resolved;
  return { pills: ordered.slice(0, max), overflow: ordered.slice(max) };
}

export type SeriesMeta = {
  ProductionYear?: number;
  EndDate?: string;
  Status?: string;
  ChildCount?: number;
};

// A series' running years. Continuing shows stay open ("2023 \u2013"); ended shows
// close ("2016 \u2013 2023", or just "2019" when it began and ended the same year).
// `abbreviate` renders the end year as two digits for the compact card ("2016 \u2013 23").
export function seriesYearRange(item: SeriesMeta, options: { abbreviate?: boolean } = {}): string {
  const start = item.ProductionYear;
  if (!start) return "";
  const endYear = item.EndDate ? new Date(item.EndDate).getUTCFullYear() : undefined;
  if (item.Status === "Continuing") return `${start} \u2013`;
  if (!endYear || Number.isNaN(endYear) || endYear <= start) return String(start);
  const end = options.abbreviate ? String(endYear).slice(-2) : String(endYear);
  return `${start} \u2013 ${end}`;
}

// The card sub-line for a series: the (abbreviated) year range plus a pluralized
// season count, e.g. "2016 \u2013 23 \u00b7 6 Seasons". Either half is dropped when unknown.
export function seriesCardMeta(item: SeriesMeta): string {
  const range = seriesYearRange(item, { abbreviate: true });
  const seasons = item.ChildCount && item.ChildCount > 0
    ? `${item.ChildCount} ${item.ChildCount === 1 ? "Season" : "Seasons"}`
    : "";
  return [range, seasons].filter(Boolean).join(" \u00b7 ");
}

export function studioLabel(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.toLowerCase().startsWith("walt disney animation") ? "Disney" : normalized;
}

export function productionDetails(item: ProductionMetadata): ProductionDetail[] {
  const { pills, overflow } = countryPills(item.ProductionLocations, Infinity);
  const countries = [...pills, ...overflow].map((country) => country.label);
  const studios = [...new Set((item.Studios ?? [])
    .map((studio) => studio.Name.trim())
    .filter(Boolean))];
  const details: ProductionDetail[] = [];
  if (countries.length) details.push({
    label: countries.length === 1 ? "Country of production" : "Countries of production",
    value: countries.join(" · "),
  });
  if (studios.length) details.push({
    label: studios.length === 1 ? "Production company" : "Production companies",
    value: studios.join(" · "),
  });
  const premiere = item.PremiereDate ? new Date(item.PremiereDate) : undefined;
  const release = premiere && !Number.isNaN(premiere.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(premiere)
    : item.ProductionYear ? String(item.ProductionYear) : undefined;
  if (release) details.push({ label: "Original release", value: release });
  return details;
}

export function scoreSource(kind: ScoreKind, providerIds?: Record<string, string>): { label: string; description: string; href?: string } {
  if (kind === "community") {
    const id = providerIds?.Imdb?.trim();
    return {
      label: "IMDb rating",
      description: "IMDb's weighted average of ratings submitted by registered users.",
      href: id && /^tt\d+$/.test(id) ? `https://www.imdb.com/title/${id}/` : undefined,
    };
  }
  const id = providerIds?.RottenTomatoes?.trim().replace(/^\/+/, "");
  return {
    label: "Tomatometer",
    description: "The share of approved critics' reviews rated positive by Rotten Tomatoes.",
    href: id && /^(m|tv)\/[a-z0-9_-]+$/i.test(id) ? `https://www.rottentomatoes.com/${id}` : undefined,
  };
}



