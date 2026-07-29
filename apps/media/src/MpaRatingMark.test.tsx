import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MpaRatingMark } from "./MpaRatingMark";

describe("MpaRatingMark", () => {
  it.each(["G", "PG", "PG-13", "R", "NC-17"] as const)(
    "renders the official %s glyph inside a locally drawn frame",
    (label) => {
      const markup = renderToStaticMarkup(<MpaRatingMark label={label} />);

      expect(markup).toContain(`data-rating="${label}"`);
      expect(markup).toContain("mpa-rating-mark-glyph");
      expect(markup).toContain("<svg");
      expect(markup).not.toContain('fill="#fff"');
      expect(markup).not.toContain("<img");
    },
  );

  it("keeps long classifications wider than single-letter classifications", () => {
    const gMarkup = renderToStaticMarkup(<MpaRatingMark label="G" />);
    const pg13Markup = renderToStaticMarkup(<MpaRatingMark label="PG-13" />);

    expect(gMarkup).toContain('viewBox="4.261 2.727 24.311 20.496"');
    expect(pg13Markup).toContain('viewBox="1.445 15.332 49.223 13.278"');
  });
});
