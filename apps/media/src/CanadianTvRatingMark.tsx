type CanadianTvRatingMarkProps = {
  label: "14+" | "18+";
};

/**
 * Canadian English-language television classification mark. The frame's
 * maple-leaf corner is part of the rating system's broadcast artwork, not a
 * decorative Video treatment.
 */
export function CanadianTvRatingMark({ label }: CanadianTvRatingMarkProps) {
  return (
    <svg
      className="canadian-tv-rating-mark"
      data-rating={label}
      viewBox="0 0 64 53"
      role="img"
      aria-hidden="true"
    >
      <title>{`Canadian television rating ${label}`}</title>
      <path
        className="canadian-tv-rating-mark-frame"
        fillRule="evenodd"
        d="M0 10h28.7l-.3-5.2 4.6 4L38.4 0l4.1 9.2 6.5-2.8-2.3 12.3 7.1-6 2.4 5.1 7-.5-2.5 8.2 3.3 1.2-11.4 9.8V53H0V10Zm5.2 3.6v34.2h42.2V34.1l9.6-6.6-2.1-.7 1.5-5-4.7.4-1.2-2.7-8.6 7.3 2.1-11.6-3.6 1.5-2.4-5.4-3.7 6.2-1.7-1.5.1 2.2H5.2V13.6Z"
      />
      <text
        className="canadian-tv-rating-mark-label"
        x="26.3"
        y="40"
        textAnchor="middle"
      >
        {label}
      </text>
    </svg>
  );
}
