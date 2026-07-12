import type { MediaItem } from "./api";

export type MovieShelf = {
  id: "acclaimed" | "sci-fi" | "action" | "comedy" | "family" | "history" | "romance";
  title: string;
  items: MediaItem[];
};

type ShelfDefinition = Omit<MovieShelf, "items"> & {
  matches: (item: MediaItem) => boolean;
  sort: (left: MediaItem, right: MediaItem) => number;
};

const titleCollator = new Intl.Collator(undefined, { sensitivity: "base" });

function score(value?: number): number {
  return Number.isFinite(value) ? value as number : -1;
}

function compareAudience(left: MediaItem, right: MediaItem): number {
  return score(right.CommunityRating) - score(left.CommunityRating)
    || score(right.CriticRating) - score(left.CriticRating)
    || (right.ProductionYear ?? 0) - (left.ProductionYear ?? 0)
    || titleCollator.compare(left.Name, right.Name);
}

function compareCritics(left: MediaItem, right: MediaItem): number {
  return score(right.CriticRating) - score(left.CriticRating)
    || score(right.CommunityRating) - score(left.CommunityRating)
    || (right.ProductionYear ?? 0) - (left.ProductionYear ?? 0)
    || titleCollator.compare(left.Name, right.Name);
}

function hasGenre(item: MediaItem, ...genres: string[]): boolean {
  const available = new Set((item.Genres ?? []).map((genre) => genre.toLocaleLowerCase()));
  return genres.some((genre) => available.has(genre.toLocaleLowerCase()));
}

const shelfDefinitions: ShelfDefinition[] = [
  { id: "acclaimed", title: "Critically acclaimed", matches: (item) => score(item.CriticRating) >= 90, sort: compareCritics },
  { id: "sci-fi", title: "Sci-Fi worlds", matches: (item) => hasGenre(item, "Science Fiction"), sort: compareAudience },
  { id: "action", title: "Action & adventure", matches: (item) => hasGenre(item, "Action"), sort: compareAudience },
  { id: "comedy", title: "Comedy", matches: (item) => hasGenre(item, "Comedy"), sort: compareAudience },
  { id: "family", title: "Family night", matches: (item) => hasGenre(item, "Family", "Animation"), sort: compareAudience },
  { id: "history", title: "History & true stories", matches: (item) => hasGenre(item, "Documentary", "History", "War"), sort: compareAudience },
  { id: "romance", title: "Romance", matches: (item) => hasGenre(item, "Romance"), sort: compareAudience },
];

export function buildMovieShelves(movies: MediaItem[], minimumSize = 4): MovieShelf[] {
  const availableMovies = movies.filter((item) => item.Type === "Movie");
  return shelfDefinitions.flatMap((definition) => {
    const items = availableMovies.filter(definition.matches).sort(definition.sort);
    return items.length >= minimumSize ? [{ id: definition.id, title: definition.title, items }] : [];
  });
}
