export const progressEvents = [
  "pause",
  "seeked",
  "visibilitychange",
  "pagehide",
  "airplaychange",
  "teardown",
] as const;

export const airPlayNoticeDurationMs = 5_000;
export const captionPrefsVersion = 4;
export const titleDisplayDurationMs = 7_000;
export const pauseSynopsisDurationSeconds = 1.05;

export type PlayerKeyboardAction = "toggle" | "seek-back" | "seek-forward" | "volume-up" | "volume-down" | "mute" | "captions" | "fullscreen";

export function playerKeyboardAction(key: string, code = ""): PlayerKeyboardAction | null {
  const normalizedKey = key.toLowerCase();
  const normalizedCode = code.toLowerCase();
  if (key === " " || key === "Spacebar" || normalizedKey === "k" || normalizedCode === "space" || normalizedCode === "keyk") return "toggle";
  if (normalizedKey === "arrowleft" || normalizedKey === "j" || normalizedCode === "arrowleft" || normalizedCode === "keyj") return "seek-back";
  if (normalizedKey === "arrowright" || normalizedKey === "l" || normalizedCode === "arrowright" || normalizedCode === "keyl") return "seek-forward";
  if (normalizedKey === "arrowup" || normalizedCode === "arrowup") return "volume-up";
  if (normalizedKey === "arrowdown" || normalizedCode === "arrowdown") return "volume-down";
  if (normalizedKey === "m" || normalizedCode === "keym") return "mute";
  if (normalizedKey === "c" || normalizedCode === "keyc") return "captions";
  if (normalizedKey === "f" || normalizedCode === "keyf") return "fullscreen";
  return null;
}

export function isPlaybackToggleKey(key: string, code = ""): boolean {
  return playerKeyboardAction(key, code) === "toggle";
}

export function shouldArmTitleTimer(titleVisible: boolean): boolean {
  // Pointer movement fires continuously. Only a hidden title should start a
  // fresh display window; otherwise mouse jitter can postpone hiding forever.
  return !titleVisible;
}

export function playerTitleOwners(pauseCinema: boolean, titleLingering: boolean, pauseTitleHandoff = false): {
  corner: boolean;
  pause: boolean;
} {
  // Keep the corner copy stationary while the pause backdrop fades in. The
  // copies are not shared-layout elements, so this overlap cannot pull or clip
  // the corner title toward its larger pause-screen position.
  return {
    corner: titleLingering && (!pauseCinema || pauseTitleHandoff),
    pause: pauseCinema,
  };
}

export function migrateCaptionDefaults<T extends {
  version?: number;
  fontSize?: number;
  lineHeight?: number;
  backgroundOpacity?: number;
  portraitOffset?: number;
}>(saved: T): T {
  if (saved.version === captionPrefsVersion) return saved;
  const migrated = { ...saved };
  if (saved.fontSize === 75) migrated.fontSize = 85;
  if (saved.lineHeight === 1.25 || saved.lineHeight === 1.45 || saved.lineHeight === 1.53) migrated.lineHeight = 1.52;
  if (saved.backgroundOpacity === .72) migrated.backgroundOpacity = .5;
  if (saved.portraitOffset === 8) migrated.portraitOffset = 12;
  return migrated;
}

export function captionFontSize(value?: number): number {
  if (!Number.isFinite(value)) return 85;
  return Math.min(200, Math.max(0, value as number));
}

export function captionVerticalOffset(value?: number): number {
  if (!Number.isFinite(value)) return 8;
  return Math.min(30, Math.max(0, value as number));
}

export function captionLineHeight(value?: number): number {
  if (!Number.isFinite(value)) return 1.52;
  return Math.min(2, Math.max(1.45, value as number));
}

export function prefersViewportFullscreen(maxTouchPoints = 0, coarsePointer = false, userAgent = ""): boolean {
  // Browser and UA claims are not trustworthy on iOS. A touch-capable or
  // coarse-pointer client never probes fullscreen APIs that WebKit can redirect
  // into Apple's native video player.
  const maskedIPadBrave = /Macintosh.*AppleWebKit\/605\..*Safari\/.*\bBrave\b/.test(userAgent);
  return maxTouchPoints > 0 || coarsePointer || maskedIPadBrave;
}

export function fullscreenStrategy(
  canStandardFullscreenShell: boolean,
  canLegacyFullscreenShell: boolean,
  forbidLegacyFullscreen = false,
): "standard-shell" | "legacy-shell" | "viewport" {
  if (canStandardFullscreenShell) return "standard-shell";
  if (canLegacyFullscreenShell && !forbidLegacyFullscreen) return "legacy-shell";
  return "viewport";
}

export function airPlayUnavailableMessage(userAgent: string): string {
  return /Macintosh|Mac OS X/.test(userAgent)
    ? "Direct AirPlay requires Safari on this Mac. Open this page in Safari or use Screen Mirroring."
    : "AirPlay is not available in this browser.";
}

export function pauseCinemaVisible(paused: boolean, elapsedMs: number): boolean {
  return paused && elapsedMs >= 10_000;
}

export function pauseCinemaDelays(hasEpisode: boolean): {
  title: number;
  year: number;
  episode?: number;
  synopsis: number;
} {
  return hasEpisode
    ? { title: .62, year: 1.32, episode: 2.02, synopsis: 2.72 }
    : { title: .62, year: 1.32, synopsis: 2.02 };
}

export function shouldAutoPictureInPicture(paused: boolean, ended: boolean, readyState: number): boolean {
  return !paused && !ended && readyState >= 2;
}

export type PlaybackStatsInput = {
  width?: number;
  height?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  mode: string;
  container?: string;
  videoCodec?: string;
  videoProfile?: string;
  bitDepth?: number;
  frameRate?: number;
  videoBitrate?: number;
  audioCodec?: string;
  audioChannels?: number;
  sampleRate?: number;
  audioBitrate?: number;
  position?: number;
  duration?: number;
  bufferedSeconds?: number;
  droppedFrames?: number;
  totalFrames?: number;
  bandwidth?: number;
  hlsLevel?: string;
  readyState?: number;
  networkState?: number;
  rate: number;
};

function mediaTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function bitrate(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)} Mbps` : `${Math.round(value / 1_000)} kbps`;
}

export function formatPlaybackStats(input: PlaybackStatsInput): Array<[string, string]> {
  const stats: Array<[string, string]> = [];
  if (input.width && input.height) stats.push(["Resolution", `${input.width} × ${input.height}`]);
  if (input.viewportWidth && input.viewportHeight) stats.push(["Player", `${input.viewportWidth} × ${input.viewportHeight}`]);
  stats.push(["Playback", input.mode]);
  if (input.container) stats.push(["Container", input.container.toUpperCase()]);
  if (input.videoCodec) {
    const details = [input.videoCodec.toUpperCase(), input.videoProfile, input.bitDepth ? `${input.bitDepth}-bit` : undefined].filter(Boolean);
    stats.push(["Video", details.join(" · ")]);
  }
  if (Number.isFinite(input.frameRate)) stats.push(["Frame rate", `${input.frameRate?.toFixed(3).replace(/\.0+$/, "")} fps`]);
  if (Number.isFinite(input.videoBitrate)) stats.push(["Video bitrate", bitrate(input.videoBitrate ?? 0)]);
  if (input.audioCodec) {
    const details = [input.audioCodec.toUpperCase(), input.audioChannels ? `${input.audioChannels} ch` : undefined, input.sampleRate ? `${input.sampleRate / 1_000} kHz` : undefined].filter(Boolean);
    stats.push(["Audio", details.join(" · ")]);
  }
  if (Number.isFinite(input.audioBitrate)) stats.push(["Audio bitrate", bitrate(input.audioBitrate ?? 0)]);
  if (Number.isFinite(input.position) && Number.isFinite(input.duration)) stats.push(["Position", `${mediaTime(input.position ?? 0)} / ${mediaTime(input.duration ?? 0)}`]);
  if (Number.isFinite(input.bufferedSeconds)) stats.push(["Buffer", `${Math.max(0, input.bufferedSeconds ?? 0).toFixed(1)} s`]);
  if (Number.isFinite(input.droppedFrames) && Number.isFinite(input.totalFrames)) {
    stats.push(["Frames", `${input.droppedFrames?.toLocaleString()} dropped / ${input.totalFrames?.toLocaleString()}`]);
  }
  if (input.hlsLevel) stats.push(["HLS level", input.hlsLevel]);
  if (Number.isFinite(input.bandwidth)) stats.push(["Bandwidth", bitrate(input.bandwidth ?? 0)]);
  if (Number.isFinite(input.readyState) && Number.isFinite(input.networkState)) {
    const ready = ["Empty", "Metadata", "Current data", "Future data", "Ready"][input.readyState ?? 0] ?? `Ready ${input.readyState}`;
    const network = ["Empty", "Idle", "Loading", "No source"][input.networkState ?? 0] ?? `Network ${input.networkState}`;
    stats.push(["Media state", `${ready} · ${network}`]);
  }
  stats.push(["Speed", `${input.rate}×`]);
  return stats;
}

export const webPlaybackProfile = {
  Name: "Video Web",
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

export function webPlaybackProfileFor(supportsHevc: boolean) {
  if (!supportsHevc) return webPlaybackProfile;
  return {
    ...webPlaybackProfile,
    DirectPlayProfiles: [
      ...webPlaybackProfile.DirectPlayProfiles,
      { Container: "mp4,m4v", Type: "Video", VideoCodec: "hevc,h265", AudioCodec: "aac,mp3,ac3,eac3" },
      { Container: "hls", Type: "Video", VideoCodec: "hevc,h264", AudioCodec: "aac,ac3,eac3" },
    ],
    TranscodingProfiles: [
      {
        Container: "mp4",
        Type: "Video",
        VideoCodec: "hevc,h264",
        AudioCodec: "eac3,ac3,aac",
        Protocol: "hls",
        Context: "Streaming",
        MaxAudioChannels: "8",
        MinSegments: 2,
        SegmentLength: 1,
        BreakOnNonKeyFrames: true,
      },
    ],
  } as const;
}

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
