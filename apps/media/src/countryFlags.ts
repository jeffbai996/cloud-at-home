const bundledCountryFlags = new Set([
  "US", "CA", "GB", "JP", "CN", "HK", "KR", "FR", "DE", "AU", "CH",
  "NZ", "IN", "PL", "FI", "NL", "ES", "CZ", "ZA",
  "AR",
]);

export function countryFlagPath(code?: string): string | undefined {
  const normalized = code?.toUpperCase();
  return normalized && bundledCountryFlags.has(normalized) ? `/flags/${normalized.toLowerCase()}.svg` : undefined;
}
