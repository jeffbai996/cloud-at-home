import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CanadianTvRatingMark } from "./CanadianTvRatingMark";

describe("CanadianTvRatingMark", () => {
  it.each(["14+", "18+"] as const)("renders the %s classification as vector artwork", (label) => {
    const markup = renderToStaticMarkup(<CanadianTvRatingMark label={label} />);

    expect(markup).toContain("<svg");
    expect(markup).toContain(`data-rating="${label}"`);
    expect(markup).toContain(`<title>Canadian television rating ${label}</title>`);
    expect(markup).toContain('class="canadian-tv-rating-mark-frame"');
    expect(markup).toContain('class="canadian-tv-rating-mark-label"');
    expect(markup).toContain("H5.2V13.6");
    expect(markup).not.toContain("<img");
  });
});
