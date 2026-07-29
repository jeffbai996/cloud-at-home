import gArtwork from "./assets/mpa-ratings/g.svg?raw";
import nc17Artwork from "./assets/mpa-ratings/nc-17.svg?raw";
import pgArtwork from "./assets/mpa-ratings/pg.svg?raw";
import pg13Artwork from "./assets/mpa-ratings/pg-13.svg?raw";
import rArtwork from "./assets/mpa-ratings/r.svg?raw";

export type MpaRatingLabel = "G" | "PG" | "PG-13" | "R" | "NC-17";

const artworkByLabel: Record<MpaRatingLabel, string> = {
  G: gArtwork,
  PG: pgArtwork,
  "PG-13": pg13Artwork,
  R: rArtwork,
  "NC-17": nc17Artwork,
};

const glyphViewBoxByLabel: Record<MpaRatingLabel, string> = {
  G: "4.261 2.727 24.311 20.496",
  PG: "3.222 13.847 43.089 19.832",
  "PG-13": "1.445 15.332 49.223 13.278",
  R: "2.843 11.825 31.939 23.172",
  "NC-17": "2.056 12.839 52.286 13.623",
};

function officialGlyph(svg: string): string {
  const group = svg.match(/<g\b[^>]*fill="#(?!fff\b)[^"]+"[^>]*>[\s\S]*?<\/g>/i);
  if (group) return group[0];
  const paths = svg.match(/<path\b[^>]*\/>/gi)?.filter(
    (path) => /fill="#(?!fff\b)[^"]+"/i.test(path),
  );
  if (!paths?.length) throw new Error("MPA artwork is missing its rating glyph");
  return paths.join("");
}

/**
 * Official MPA rating glyph inside a locally drawn frame. Keeping the artwork
 * and frame separate lets long classifications retain honest proportions.
 */
export function MpaRatingMark({ label }: { label: MpaRatingLabel }) {
  return (
    <span className="mpa-rating-mark" data-rating={label}>
      <svg
        className="mpa-rating-mark-glyph"
        viewBox={glyphViewBoxByLabel[label]}
        aria-hidden="true"
        focusable="false"
        dangerouslySetInnerHTML={{ __html: officialGlyph(artworkByLabel[label]) }}
      />
    </span>
  );
}
