export type RatingBadge = {
  label: string;
  scheme: "ca" | "ca-tv" | "us-tv" | "us-film" | "plain";
  shape: "circle" | "rounded" | "hex" | "diamond" | "octagon" | "plaque";
  tone: "green" | "yellow" | "blue" | "red" | "mono";
  ariaLabel: string;
  name: string;
  authority: string;
  description: string;
  authorityUrl?: string;
};

type RatingGuidance = Pick<RatingBadge, "name" | "authority" | "description" | "authorityUrl">;

const bcFilmClassificationUrl = "https://www.consumerprotectionbc.ca/motion-picture-ratings/what-ratings-mean/";
const canadianTvUrl = "https://www.cbsc.ca/tools/for-english-ca-and-third-language-broadcasters/";
const tvGuidelinesUrl = "https://www.tvguidelines.org/ratings.html";
const mpaUrl = "https://www.filmratings.com/ratings-guide/";

const canadianFilmGuidance: Record<string, RatingGuidance> = {
  G: { name: "General", authority: "British Columbia Film Classification Office", description: "Suitable for viewers of all ages.", authorityUrl: bcFilmClassificationUrl },
  PG: { name: "Parental Guidance", authority: "British Columbia Film Classification Office", description: "Theme or content may not be suitable for all children. Parental discretion is advised.", authorityUrl: bcFilmClassificationUrl },
  "14A": { name: "14 Accompaniment", authority: "British Columbia Film Classification Office", description: "Suitable for viewers 14 years of age or older. Viewers under 14 years of age must be accompanied by an adult.", authorityUrl: bcFilmClassificationUrl },
  "18A": { name: "18 Accompaniment", authority: "British Columbia Film Classification Office", description: "Suitable for viewers 18 years of age or older. Viewers under 18 years of age must be accompanied by an adult.", authorityUrl: bcFilmClassificationUrl },
  R: { name: "Restricted", authority: "British Columbia Film Classification Office", description: "Restricted to viewers 18 years of age and over. Persons under 18 years of age are not permitted to attend under any circumstances.", authorityUrl: bcFilmClassificationUrl },
  A: { name: "Adult", authority: "British Columbia Film Classification Office", description: "Restricted to viewers 18 years of age and over. Persons under 18 years of age are not permitted to attend under any circumstances.", authorityUrl: bcFilmClassificationUrl },
};

const canadianTvGuidance: Record<string, RatingGuidance> = {
  "14+": { name: "Viewers 14 and older", authority: "Canadian Broadcast Standards Council", description: "May contain themes or content unsuitable for viewers under 14. Parents are strongly cautioned to use discretion.", authorityUrl: canadianTvUrl },
  "18+": { name: "Adult Programming", authority: "Canadian Broadcast Standards Council", description: "May contain content unsuitable for viewers under 18.", authorityUrl: canadianTvUrl },
};

const tvGuidance: Record<string, RatingGuidance> = {
  "TV-Y": { name: "All Children", authority: "TV Parental Guidelines", description: "Designed to be appropriate for all children.", authorityUrl: tvGuidelinesUrl },
  "TV-Y7": { name: "Directed to Older Children", authority: "TV Parental Guidelines", description: "Designed for children age 7 and above.", authorityUrl: tvGuidelinesUrl },
  "TV-G": { name: "General Audience", authority: "TV Parental Guidelines", description: "Most parents would find this program suitable for all ages.", authorityUrl: tvGuidelinesUrl },
  "TV-PG": { name: "Parental Guidance Suggested", authority: "TV Parental Guidelines", description: "Contains material that parents may find unsuitable for younger children.", authorityUrl: tvGuidelinesUrl },
  "TV-14": { name: "Parents Strongly Cautioned", authority: "TV Parental Guidelines", description: "Contains material many parents would find unsuitable for children under 14.", authorityUrl: tvGuidelinesUrl },
  "TV-MA": { name: "Mature Audience Only", authority: "TV Parental Guidelines", description: "Designed for adults and may be unsuitable for children under 17.", authorityUrl: tvGuidelinesUrl },
};

const mpaGuidance: Record<string, RatingGuidance> = {
  G: { name: "General Audiences", authority: "Motion Picture Association of America", description: "All ages admitted.", authorityUrl: mpaUrl },
  PG: { name: "Parental Guidance Suggested", authority: "Motion Picture Association of America", description: "Some material may not be suitable for children.", authorityUrl: mpaUrl },
  "PG-13": { name: "Parents Strongly Cautioned", authority: "Motion Picture Association of America", description: "Some material may be inappropriate for children under 13.", authorityUrl: mpaUrl },
  R: { name: "Restricted", authority: "Motion Picture Association of America", description: "Under 17 requires an accompanying parent or adult guardian.", authorityUrl: mpaUrl },
  "NC-17": { name: "Adults Only", authority: "Motion Picture Association of America", description: "No one 17 and under admitted.", authorityUrl: mpaUrl },
  NR: { name: "Not Rated", authority: "Motion Picture Association of America", description: "This title has not been assigned an MPAA rating.", authorityUrl: mpaUrl },
};

const canadianTones: Record<string, RatingBadge["tone"]> = {
  G: "green",
  PG: "yellow",
  "14A": "blue",
  "18A": "red",
  R: "red",
  A: "red",
};

const canadianShapes: Record<string, RatingBadge["shape"]> = {
  G: "circle",
  PG: "rounded",
  "14A": "hex",
  "18A": "diamond",
  R: "circle",
  A: "circle",
};

export function ratingBadge(value: string): RatingBadge {
  const rating = value.trim().toUpperCase();
  const canadianLabel = rating.startsWith("CA-") ? rating.slice(3) : "";
  if (canadianTvGuidance[canadianLabel]) {
    return { label: canadianLabel, scheme: "ca-tv", shape: "plaque", tone: canadianLabel === "14+" ? "blue" : "red", ariaLabel: `Canadian television rating ${canadianLabel}`, ...canadianTvGuidance[canadianLabel] };
  }
  if (canadianLabel && canadianTones[canadianLabel]) {
    const guidance = canadianFilmGuidance[canadianLabel];
    return {
      label: canadianLabel,
      scheme: "ca",
      shape: canadianShapes[canadianLabel],
      tone: canadianTones[canadianLabel],
      ariaLabel: `Canadian rating ${canadianLabel}`,
      ...guidance,
    };
  }
  if (/^TV-(Y7?|G|PG|14|MA)$/.test(rating)) {
    return { label: rating, scheme: "us-tv", shape: "plaque", tone: "mono", ariaLabel: `TV rating ${rating}`, ...tvGuidance[rating] };
  }
  if (/^(G|PG|PG-13|R|NC-17|NR)$/.test(rating)) {
    return { label: rating, scheme: "us-film", shape: "plaque", tone: "mono", ariaLabel: `Rated ${rating}`, ...mpaGuidance[rating] };
  }
  return { label: value, scheme: "plain", shape: "plaque", tone: "mono", ariaLabel: `Rated ${value}`, name: value, authority: "Media library", description: "No classification guidance is available for this rating.", authorityUrl: undefined };
}
