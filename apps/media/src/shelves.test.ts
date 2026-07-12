import { describe, expect, it } from "vitest";

import type { MediaItem } from "./api";
import { buildMovieShelves } from "./shelves";

function movie(name: string, options: Partial<MediaItem> = {}): MediaItem {
  return { Id: name.toLowerCase().replaceAll(" ", "-"), Name: name, Type: "Movie", ...options };
}

describe("curated movie shelves", () => {
  it("allows a movie to appear in every matching shelf", () => {
    const crossover = movie("Crossover", { Genres: ["Science Fiction", "Comedy", "Romance"], CommunityRating: 8.1 });
    const shelves = buildMovieShelves([crossover], 1);
    expect(shelves.filter((shelf) => shelf.items.includes(crossover)).map((shelf) => shelf.id)).toEqual(["sci-fi", "comedy", "romance"]);
  });

  it("uses a strict critic threshold for the acclaimed shelf", () => {
    const shelves = buildMovieShelves([movie("Included", { CriticRating: 90 }), movie("Excluded", { CriticRating: 89 })], 1);
    expect(shelves.find((shelf) => shelf.id === "acclaimed")?.items.map((item) => item.Name)).toEqual(["Included"]);
  });

  it("sorts genre shelves by viewer score, critic score, year, then title", () => {
    const shelves = buildMovieShelves([
      movie("Later title", { Genres: ["Comedy"], CommunityRating: 8, CriticRating: 80, ProductionYear: 2020 }),
      movie("Critic favorite", { Genres: ["Comedy"], CommunityRating: 8, CriticRating: 95, ProductionYear: 2010 }),
      movie("Lower score", { Genres: ["Comedy"], CommunityRating: 7.5, CriticRating: 99, ProductionYear: 2025 }),
    ], 1);
    expect(shelves.find((shelf) => shelf.id === "comedy")?.items.map((item) => item.Name)).toEqual(["Critic favorite", "Later title", "Lower score"]);
  });

  it("hides shelves that are too sparse", () => {
    const threeActionMovies = ["One", "Two", "Three"].map((name) => movie(name, { Genres: ["Action"] }));
    expect(buildMovieShelves(threeActionMovies).some((shelf) => shelf.id === "action")).toBe(false);
    expect(buildMovieShelves([...threeActionMovies, movie("Four", { Genres: ["Action"] })]).some((shelf) => shelf.id === "action")).toBe(true);
  });
});
