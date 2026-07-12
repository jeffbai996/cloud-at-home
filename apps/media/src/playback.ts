export const progressEvents = [
  "pause",
  "seeked",
  "visibilitychange",
  "pagehide",
  "airplaychange",
  "teardown",
] as const;

export const airPlayNoticeDurationMs = 5_000;

export function captionFontSize(value?: number): number {
  if (!Number.isFinite(value)) return 75;
  return Math.min(200, Math.max(0, value as number));
}

export function captionVerticalOffset(value?: number): number {
  if (!Number.isFinite(value)) return 8;
  return Math.min(30, Math.max(0, value as number));
}

export function usesNativeVideoFullscreen(userAgent: string): boolean {
  return /iPhone|iPod/.test(userAgent);
}

export function airPlayUnavailableMessage(userAgent: string): string {
  return /Macintosh|Mac OS X/.test(userAgent)
    ? "Direct AirPlay requires Safari on this Mac. Open this page in Safari or use Screen Mirroring."
    : "AirPlay is not available in this browser.";
}

export function pauseCinemaVisible(paused: boolean, elapsedMs: number): boolean {
  return paused && elapsedMs >= 10_000;
}

export function shouldAutoPictureInPicture(paused: boolean, ended: boolean, readyState: number): boolean {
  return !paused && !ended && readyState >= 2;
}

export type PlaybackStatsInput = {
  width?: number;
  height?: number;
  mode: string;
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  bufferedSeconds?: number;
  droppedFrames?: number;
  totalFrames?: number;
  rate: number;
};

export function formatPlaybackStats(input: PlaybackStatsInput): Array<[string, string]> {
  const stats: Array<[string, string]> = [];
  if (input.width && input.height) stats.push(["Resolution", `${input.width} × ${input.height}`]);
  stats.push(["Playback", input.mode]);
  if (input.container) stats.push(["Container", input.container.toUpperCase()]);
  if (input.videoCodec) stats.push(["Video", input.videoCodec.toUpperCase()]);
  if (input.audioCodec) stats.push(["Audio", input.audioCodec.toUpperCase()]);
  if (Number.isFinite(input.bufferedSeconds)) stats.push(["Buffer", `${Math.max(0, input.bufferedSeconds ?? 0).toFixed(1)} s`]);
  if (Number.isFinite(input.droppedFrames) && Number.isFinite(input.totalFrames)) {
    stats.push(["Frames", `${input.droppedFrames?.toLocaleString()} dropped / ${input.totalFrames?.toLocaleString()}`]);
  }
  stats.push(["Speed", `${input.rate}×`]);
  return stats;
}

export const webPlaybackProfile = {
  Name: "Cloud Media Web",
  MaxStreamingBitrate: 120_000_000,
  DirectPlayProfiles: [
    { Container: "mp4,m4v", Type: "Video", VideoCodec: "h264", AudioCodec: "aac,mp3,ac3" },
  ],
  TranscodingProfiles: [
    {
      Container: "ts",
      Type: "Video",
      VideoCodec: "h264",
      AudioCodec: "aac",
      Protocol: "hls",
      Context: "Streaming",
      MaxAudioChannels: "2",
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
    },
  ],
  SubtitleProfiles: [
    { Format: "srt", Method: "External" },
    { Format: "subrip", Method: "External" },
    { Format: "vtt", Method: "External" },
    { Format: "webvtt", Method: "External" },
  ],
} as const;

export function shouldReportProgress(input: {
  previous: number;
  current: number;
  paused: boolean;
}): boolean {
  return input.paused || Math.abs(input.current - input.previous) >= 5;
}

export function resumePosition(saved: number, duration: number): number {
  const normalized = Math.max(0, Number.isFinite(saved) ? saved : 0);
  return Number.isFinite(duration) && duration > 0
    ? Math.min(normalized, Math.max(0, duration - 1))
    : normalized;
}

export function playbackStartPosition(saved: number, duration: number, fromBeginning: boolean): number {
  return fromBeginning ? 0 : resumePosition(saved, duration);
}

export function isResumable(playbackPositionTicks?: number, played = false): boolean {
  return !played && Number.isFinite(playbackPositionTicks) && (playbackPositionTicks ?? 0) > 0;
}

export function mediaYearLabel(item: {
  Type: string;
  ProductionYear?: number;
  SeriesName?: string;
  SeriesProductionYear?: number;
  SeriesEndDate?: string;
  EndDate?: string;
}): string {
  if (item.Type === "Movie") return item.ProductionYear ? String(item.ProductionYear) : "";
  const series = Boolean(item.SeriesName) || item.Type === "Series";
  if (!series) return "";
  const start = item.SeriesProductionYear ?? item.ProductionYear;
  if (!start) return "";
  const endDate = item.SeriesEndDate ?? item.EndDate;
  const end = endDate ? Number.parseInt(endDate.slice(0, 4), 10) : Number.NaN;
  if (Number.isFinite(end) && end === start) return String(start);
  return Number.isFinite(end) && end > start ? `${start} – ${end}` : `${start} –`;
}

export function activeCueText(cues: ArrayLike<{ text: string }> | null): string {
  if (!cues) return "";
  return Array.from(cues)
    .map((cue) => cue.text.replace(/<[^>]+>/g, ""))
    .join("\n");
}

export function subtitleTrackLabel(stream: {
  DisplayTitle?: string;
  Language?: string;
  Title?: string;
  Index: number;
}): string {
  const languages: Array<[RegExp, string]> = [
    [/^(?:en|eng)$/i, "English"],
    [/^(?:zh|zho|chi|cmn)$/i, "Chinese"],
    [/^(?:zh[-_]?hans)$/i, "Chinese Simplified"],
    [/^(?:zh[-_]?hant)$/i, "Chinese Traditional"],
    [/^(?:es|spa)$/i, "Spanish"],
    [/^(?:fr|fra|fre)$/i, "French"],
    [/^(?:de|deu|ger)$/i, "German"],
    [/^(?:ja|jpn)$/i, "Japanese"],
    [/^(?:ko|kor)$/i, "Korean"],
    [/^(?:pt|por)$/i, "Portuguese"],
    [/^(?:it|ita)$/i, "Italian"],
    [/^(?:ru|rus)$/i, "Russian"],
    [/^(?:ar|ara)$/i, "Arabic"],
    [/^(?:hi|hin)$/i, "Hindi"],
  ];
  const language = (stream.Language ?? "").trim();
  let label = languages.find(([pattern]) => pattern.test(language))?.[1];
  const metadata = [stream.DisplayTitle, stream.Title].filter(Boolean).join(" ");
  if (!label) {
    const namedLanguages = [
      "Chinese Simplified", "Chinese Traditional", "English", "Chinese", "Spanish",
      "French", "German", "Japanese", "Korean", "Portuguese", "Italian", "Russian",
      "Arabic", "Hindi",
    ];
    label = namedLanguages.find((name) => new RegExp(`\\b${name.replace(" ", "\\s+")}\\b`, "i").test(metadata));
  }
  if (!label) return `Subtitle track ${stream.Index + 1}`;
  const qualifier = /\bforced\b/i.test(metadata) ? "Forced"
    : /\b(?:sdh|hearing[ -]?impaired|closed captions?|cc)\b/i.test(metadata) ? "SDH"
      : "";
  return qualifier ? `${label} (${qualifier})` : label;
}

export type TrickplayInfo = {
  Width: number;
  Height: number;
  TileWidth: number;
  TileHeight: number;
  ThumbnailCount: number;
  Interval: number;
  Bandwidth: number;
};

export function trickplayFrame(seconds: number, info: TrickplayInfo) {
  const cellsPerTile = Math.max(1, info.TileWidth * info.TileHeight);
  const intervalSeconds = Math.max(0.001, info.Interval / 1000);
  const thumbnail = Math.min(
    Math.max(0, info.ThumbnailCount - 1),
    Math.max(0, Math.floor(seconds / intervalSeconds)),
  );
  const cell = thumbnail % cellsPerTile;
  return {
    tile: Math.floor(thumbnail / cellsPerTile),
    column: cell % info.TileWidth,
    row: Math.floor(cell / info.TileWidth),
  };
}
