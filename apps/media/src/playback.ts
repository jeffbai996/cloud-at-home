export const progressEvents = [
  "pause",
  "seeked",
  "visibilitychange",
  "pagehide",
  "airplaychange",
  "teardown",
] as const;

export const airPlayNoticeDurationMs = 5_000;
export const captionPrefsVersion = 5;
export const titleDisplayDurationMs = 7_000;
export const pauseSynopsisDurationSeconds = 1.05;

export type RatingIntroTiming = {
  index: number;
  showAtMs: number;
  hideAtMs: number;
};

const ratingVisits = new Map<string, { shown: boolean; exitedAt: number | null }>();

export function claimRatingIntro(itemId: string, now = Date.now()): boolean {
  const previous = ratingVisits.get(itemId);
  const show = !previous?.shown || (previous.exitedAt !== null && previous.exitedAt !== undefined && now - previous.exitedAt > 10 * 60_000);
  ratingVisits.set(itemId, { shown: true, exitedAt: null });
  return show;
}

export function recordRatingPlayerExit(itemId: string, now = Date.now()): void {
  const previous = ratingVisits.get(itemId);
  if (previous) ratingVisits.set(itemId, { ...previous, exitedAt: now });
}

export function ratingIntroTimings(cardCount: number): RatingIntroTiming[] {
  const initialDelayMs = 700;
  const lingerMs = 7_000;
  const gapMs = 450;
  return Array.from({ length: Math.max(0, cardCount) }, (_, index) => {
    const showAtMs = initialDelayMs + index * (lingerMs + gapMs);
    return { index, showAtMs, hideAtMs: showAtMs + lingerMs };
  });
}

export function ratingDescriptionLines(description: string): string[] {
  const boundary = /[.!?]["']?\s+/.exec(description);
  if (!boundary) return [description];
  const splitAt = (boundary.index ?? 0) + boundary[0].length;
  return [description.slice(0, splitAt).trim(), description.slice(splitAt).trim()];
}

export type PlayerKeyboardAction = "toggle" | "seek-back" | "seek-forward" | "volume-up" | "volume-down" | "mute" | "captions" | "fullscreen" | "subtitle-earlier" | "subtitle-later";

export const shortcutFlashDurationMs = 650;
export const seekStepSeconds = 10;

/** Subtitle nudge, in seconds of delay added to every cue.
 *
 * External .srt files measured against their own audio come in within about a
 * tenth of a second, so the files are rarely the thing that needs moving. What
 * does move is the STREAM: playback is always HLS, and a seek restarts the
 * transcode at the keyframe at or before the requested position while the
 * playlist still labels the segment on an even 6-second grid. This rip's
 * segments come out 8.0s, 5.8s, 12.6s against that grid, so the registration
 * between what you hear and what the timeline claims drifts by a fraction of a
 * second that depends on where you seeked to.
 *
 * That is a per-viewing amount, so it needs a per-viewing control rather than a
 * constant baked into the pipeline. A tenth of a second per press is below what
 * reads as a jump and above what reads as nothing. */
export const subtitleDelayStepSeconds = 0.1;
export const subtitleDelayLimitSeconds = 10;

/** Positive delay shows each cue LATER. Rounded every step: the accumulator is
 * a float that a user can walk a hundred presses in either direction, and
 * 0.1 + 0.2 lands at 0.30000000000000004 without it. */
export function nextSubtitleDelay(current: number, delta: number): number {
  const base = Number.isFinite(current) ? current : 0;
  const limit = subtitleDelayLimitSeconds;
  return Math.round(Math.min(limit, Math.max(-limit, base + delta)) * 100) / 100;
}

export function subtitleDelayFlash(delay: number): ShortcutFlash {
  const rounded = Number.isFinite(delay) ? delay : 0;
  const label = rounded === 0 ? "0.0s" : `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)}s`;
  return { icon: "captions", label };
}

export type ShortcutFlashIcon =
  | "play" | "pause" | "forward" | "backward"
  | "volume" | "volume-low" | "volume-muted"
  | "captions" | "captions-off";

export type ShortcutFlash = { icon: ShortcutFlashIcon; label?: string };

/** State AFTER the shortcut ran — the flash reports the result, not the key. */
export type ShortcutFlashState = {
  paused?: boolean;
  volume?: number;
  muted?: boolean;
  captionsActive?: boolean;
};

// Volume goes to 2.0 here (the player boosts past unity via a gain node), so
// the badge must not clamp at 100% or a boosted level reads as plain full.
const volumePercent = (volume: number): string =>
  `${Math.round(Math.max(0, volume) * 100)}%`;

const volumeIcon = (volume: number): ShortcutFlashIcon => {
  if (volume <= 0) return "volume-muted";
  return volume < 0.5 ? "volume-low" : "volume";
};

/**
 * The badge to flash for a keyboard shortcut, or null when the action's effect
 * is already self-evident on screen (fullscreen resizes the viewport; a digit
 * seek visibly jumps the scrubber) — a badge there is noise, not feedback.
 */
export function shortcutFlash(action: PlayerKeyboardAction, state: ShortcutFlashState): ShortcutFlash | null {
  switch (action) {
    case "toggle":
      // Show the state the key produced: still playing => the play glyph.
      return { icon: state.paused ? "pause" : "play" };
    case "seek-forward":
      return { icon: "forward", label: `${seekStepSeconds}s` };
    case "seek-back":
      return { icon: "backward", label: `${seekStepSeconds}s` };
    case "volume-up":
    case "volume-down": {
      const volume = state.volume ?? 0;
      return { icon: volumeIcon(volume), label: volumePercent(volume) };
    }
    case "mute":
      return state.muted
        ? { icon: "volume-muted", label: "Muted" }
        : { icon: volumeIcon(state.volume ?? 0), label: volumePercent(state.volume ?? 0) };
    case "captions":
      return state.captionsActive
        ? { icon: "captions", label: "On" }
        : { icon: "captions-off", label: "Off" };
    case "fullscreen":
      return null;
    // The nudge reports the delay it landed on, which this state does not
    // carry. Player shows subtitleDelayFlash instead, where the value is known.
    case "subtitle-earlier":
    case "subtitle-later":
      return null;
  }
}

/** Caption resize (+/-) reports the resulting size; it has no on-screen echo. */
export function captionSizeFlash(fontSize: number): ShortcutFlash {
  return { icon: "captions", label: `${Math.round(captionFontSize(fontSize))}%` };
}

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
  // g/h, the pair VLC and mpv already use for this. Both were free.
  if (normalizedKey === "g" || normalizedCode === "keyg") return "subtitle-earlier";
  if (normalizedKey === "h" || normalizedCode === "keyh") return "subtitle-later";
  if (normalizedKey === "f" || normalizedCode === "keyf") return "fullscreen";
  return null;
}

export function seekTime(currentTime: number, delta: number, duration: number): number {
  const current = Number.isFinite(currentTime) ? currentTime : 0;
  const end = Number.isFinite(duration) && duration >= 0 ? duration : Infinity;
  return Math.min(end, Math.max(0, current + delta));
}

export function isPlaybackToggleKey(key: string, code = ""): boolean {
  return playerKeyboardAction(key, code) === "toggle";
}

export function shouldArmTitleTimer(hidePending: boolean): boolean {
  // Pointer movement fires continuously, so a hide already on the clock must
  // never be pushed back — otherwise mouse jitter postpones it forever. A
  // visible title with no hide pending is the stuck case, and does get one.
  return !hidePending;
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
  if (saved.lineHeight === 1.25 || saved.lineHeight === 1.45 || saved.lineHeight === 1.53 || saved.lineHeight === 1.52) migrated.lineHeight = 1.49;
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
  if (!Number.isFinite(value)) return 1.49;
  return Math.min(2, Math.max(1.45, value as number));
}

// Named font-size presets for the caption panel. Values are percentages that
// feed the same fontSize field the slider drives, so a preset chip and the
// slider stay in sync.
const captionSizePresets = { small: 65, default: 85, large: 120 } as const;
export type CaptionSizePreset = keyof typeof captionSizePresets;

export function captionSizePreset(name: string): number {
  return captionSizePresets[name as CaptionSizePreset] ?? captionSizePresets.default;
}

// Reverse lookup so the UI can highlight the active chip. Returns null for a
// custom (slider-tuned) size that matches no preset, leaving every chip unlit.
export function activeCaptionPreset(fontSize: number): CaptionSizePreset | null {
  const match = (Object.keys(captionSizePresets) as CaptionSizePreset[]).find(
    (name) => captionSizePresets[name] === fontSize,
  );
  return match ?? null;
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
  engine?: string;
  captionTime?: number;
  captionClockSource?: string;
  subtitleCueStart?: number;
  subtitleCueEnd?: number;
  bufferedSeconds?: number;
  droppedFrames?: number;
  totalFrames?: number;
  bandwidth?: number;
  hlsLevel?: string;
  readyState?: number;
  networkState?: number;
  rate: number;
  subtitleTrack?: string;
  subtitleDelay?: number;
  subtitleCue?: string;
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

function mediaTimeMilliseconds(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1_000));
  const whole = Math.floor(totalMilliseconds / 1_000);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remaining = whole % 60;
  const milliseconds = totalMilliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function bitrate(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)} Mbps` : `${Math.round(value / 1_000)} kbps`;
}

export type StatSeverity = "good" | "warn" | "bad" | "neutral";

// Colour signal for the "stats for nerds" readout. Only the values that carry a
// health meaning get a colour; everything descriptive stays neutral so the
// panel does not turn into a christmas tree.
export function classifyStat(label: string, value: string): StatSeverity {
  if (label === "Playback") return /direct/i.test(value) ? "good" : "warn";
  if (label === "Frames") {
    const dropped = Number.parseInt(value.replace(/,/g, ""), 10);
    if (Number.isFinite(dropped)) return dropped > 0 ? "warn" : "good";
  }
  return "neutral";
}

export function formatPlaybackStats(input: PlaybackStatsInput): Array<[string, string]> {
  const stats: Array<[string, string]> = [];
  if (input.width && input.height) stats.push(["Resolution", `${input.width} × ${input.height}`]);
  if (input.viewportWidth && input.viewportHeight) stats.push(["Player", `${input.viewportWidth} × ${input.viewportHeight}`]);
  stats.push(["Playback", input.mode]);
  if (input.engine) stats.push(["Engine", input.engine]);
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
  if (Number.isFinite(input.position) && Number.isFinite(input.duration)) stats.push(["DOM clock", `${mediaTimeMilliseconds(input.position ?? 0)} / ${mediaTimeMilliseconds(input.duration ?? 0)}`]);
  if (Number.isFinite(input.bufferedSeconds)) stats.push(["Buffer", `${Math.max(0, input.bufferedSeconds ?? 0).toFixed(1)} s`]);
  if (Number.isFinite(input.droppedFrames) && Number.isFinite(input.totalFrames)) {
    stats.push(["Frames", `${input.droppedFrames?.toLocaleString()} dropped / ${input.totalFrames?.toLocaleString()}`]);
  }
  if (input.hlsLevel) stats.push(["HLS level", input.hlsLevel]);
  if (Number.isFinite(input.bandwidth)) stats.push(["Bandwidth est.", bitrate(input.bandwidth ?? 0)]);
  if (Number.isFinite(input.readyState) && Number.isFinite(input.networkState)) {
    const ready = ["Empty", "Metadata", "Current data", "Future data", "Ready"][input.readyState ?? 0] ?? `Ready ${input.readyState}`;
    const network = ["Empty", "Idle", "Loading", "No source"][input.networkState ?? 0] ?? `Network ${input.networkState}`;
    stats.push(["Media state", `${ready} · ${network}`]);
  }
  stats.push(["Speed", `${input.rate}×`]);
  if (input.subtitleTrack) {
    stats.push(["Subtitle", input.subtitleTrack]);
    if (Number.isFinite(input.subtitleDelay)) {
      const delay = input.subtitleDelay ?? 0;
      stats.push(["Subtitle delay", `${delay > 0 ? "+" : ""}${delay.toFixed(2)} s`]);
    }
    if (Number.isFinite(input.captionTime)) stats.push(["Caption lookup", mediaTimeMilliseconds(input.captionTime ?? 0)]);
    if (input.captionClockSource) stats.push(["Caption source", input.captionClockSource]);
    if (Number.isFinite(input.subtitleCueStart) && Number.isFinite(input.subtitleCueEnd)) {
      stats.push(["Cue window", `${mediaTimeMilliseconds(input.subtitleCueStart ?? 0)} – ${mediaTimeMilliseconds(input.subtitleCueEnd ?? 0)}`]);
    }
    stats.push(["Subtitle cue", input.subtitleCue?.replace(/\s+/g, " ").trim() || "None"]);
  }
  return stats;
}

const copiedStatLabels = new Set([
  "Resolution", "Player", "Playback", "Engine", "Container", "Video", "Frame rate",
  "Video bitrate", "Audio", "Audio bitrate", "DOM clock", "Buffer", "Frames",
  "HLS level", "Bandwidth est.", "Media state", "Speed", "Subtitle",
  "Subtitle delay", "Caption lookup", "Caption source", "Cue window", "Subtitle cue",
]);

function sanitizeDiagnosticValue(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/\b(api[_-]?key|access[_-]?token|token)=([^\s&]+)/gi, "$1=[redacted]");
}

export function formatSanitizedPlaybackDiagnostics(stats: Array<[string, string]>): string {
  const safeStats = Object.fromEntries(
    stats
      .filter(([label]) => copiedStatLabels.has(label))
      .map(([label, value]) => [label, sanitizeDiagnosticValue(value)]),
  );
  return JSON.stringify({ schema: "cloud-media-playback-stats-v1", stats: safeStats }, null, 2);
}

export const webPlaybackProfile = {
  Name: "Cloud Media Web",
  MaxStreamingBitrate: 120_000_000,
  // Compatible MP4 retains the source timeline instead of Jellyfin's estimated
  // remux segment clock. This is only enabled with the gateway's bounded-range
  // handshake: every static read is capped at 4 MiB, including open ranges.
  DirectPlayProfiles: [{ Container: "mp4,m4v", Type: "Video", VideoCodec: "h264", AudioCodec: "aac" }],
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
      // Stream-copy can only cut safely on source keyframes. Advertising one
      // second here made Jellyfin calculate seeks in one-second segment IDs
      // while FFmpeg emitted Parasite's roughly six-second GOPs. Segment 1193
      // consequently meant both ~20 minutes after a seek and near the end in
      // the original VOD cache. Keep remux numbering aligned with the media.
      SegmentLength: 6,
      BreakOnNonKeyFrames: false,
    },
  ],
  SubtitleProfiles: [
    { Format: "srt", Method: "External" },
    { Format: "subrip", Method: "External" },
    { Format: "vtt", Method: "External" },
    { Format: "webvtt", Method: "External" },
  ],
} as const;

/** What the device told us it can actually decode, probed per codec. */
export type AudioCapabilities = { ac3?: boolean; eac3?: boolean };

export type PlaybackQuality = "best" | "balanced" | "data-saver";

export type SkippableMediaSegment = {
  type: "Intro" | "Outro" | "Recap";
  startSeconds: number;
  endSeconds: number;
};

export function activeSkippableSegment(
  segments: SkippableMediaSegment[],
  positionSeconds: number,
): SkippableMediaSegment | null {
  return segments.find((segment) => (
    Number.isFinite(segment.startSeconds)
    && Number.isFinite(segment.endSeconds)
    && segment.endSeconds > segment.startSeconds
    && positionSeconds >= segment.startSeconds
    && positionSeconds < segment.endSeconds - 0.5
  )) ?? null;
}

export function skipSegmentLabel(type: SkippableMediaSegment["type"]): string {
  return type === "Intro" ? "Skip intro" : type === "Recap" ? "Skip recap" : "Skip credits";
}

export const playbackQualityOptions: Array<{ value: PlaybackQuality; label: string; detail: string; bitrate: number }> = [
  { value: "best", label: "Best", detail: "Up to 120 Mbps", bitrate: 120_000_000 },
  { value: "balanced", label: "Balanced", detail: "Up to 20 Mbps", bitrate: 20_000_000 },
  { value: "data-saver", label: "Data saver", detail: "Up to 8 Mbps", bitrate: 8_000_000 },
];

export function playbackBitrate(quality: PlaybackQuality): number {
  return playbackQualityOptions.find((option) => option.value === quality)?.bitrate ?? 120_000_000;
}

export function playbackProfileQuality<T extends { MaxStreamingBitrate?: number }>(profile: T, quality: PlaybackQuality): T {
  return { ...profile, MaxStreamingBitrate: playbackBitrate(quality) };
}

export function audioTrackLabel(stream: {
  Index: number;
  DisplayTitle?: string;
  AiTranslated?: boolean;
  Language?: string;
  Codec?: string;
  Channels?: number;
  IsDefault?: boolean;
}): string {
  const language = subtitleTrackLabel({
    Index: stream.Index,
    DisplayTitle: stream.DisplayTitle,
    Language: stream.Language,
  }).replace(/ \((?:SDH|Forced)\)$/i, "");
  const description = /audio description|descriptive/i.test(stream.DisplayTitle ?? "") ? "Audio Description" : "";
  const channels = stream.Channels && stream.Channels > 2
    ? (stream.Channels >= 6 ? "5.1" : `${stream.Channels}.0`)
    : "";
  return [language, description || channels].filter(Boolean).join(" · ");
}

/** Jellyfin reads these lists as a PREFERENCE ORDER, so whatever is first is
 *  what a transcode produces. Surround only leads when the device claimed it;
 *  aac is always last so there is a decodable floor. */
export function audioCodecPreference(audio: AudioCapabilities): string {
  const surround = [audio.eac3 ? "eac3" : "", audio.ac3 ? "ac3" : ""].filter(Boolean);
  return [...surround, "aac"].join(",");
}

export function webPlaybackProfileFor(supportsHevc: boolean, audio: AudioCapabilities = {}, acceleratedTranscode = false) {
  if (!supportsHevc) {
    if (!acceleratedTranscode) return webPlaybackProfile;
    // A real video transcode can insert keyframes at one-second boundaries, so
    // the short-segment startup optimization is safe there. It is deliberately
    // separate from the stream-copy profile above.
    return {
      ...webPlaybackProfile,
      Name: "Cloud Media Web Transcode",
      TranscodingProfiles: webPlaybackProfile.TranscodingProfiles.map((profile) => ({
        ...profile,
        SegmentLength: 1,
        BreakOnNonKeyFrames: true,
      })),
    };
  }
  // AUDIO IS PROBED SEPARATELY FROM HEVC. This branch used to
  // advertise "eac3,ac3,aac" to anything that could decode HEVC *video* — two
  // unrelated capabilities. Because the list is a preference order, every
  // title whose audio needed re-encoding came back as AC-3, which no browser
  // decodes; the player died on MEDIA_ERR_DECODE and sat paused forever.
  // Proven at the manifest for a DTS source:
  //   supportsHevc=false -> CODECS="avc1.640029,mp4a.40.2"   plays
  //   supportsHevc=true  -> CODECS="avc1.640029,ac-3"        dead
  // 14 of 89 titles have a non-AAC default track, so it looked intermittent.
  const audioCodecs = audioCodecPreference(audio);
  const hasSurround = audioCodecs !== "aac";
  return {
    ...webPlaybackProfile,
    // "hls" direct play stays: it IS segment streaming (bounded requests),
    // just without a repackage when the source is already HLS-compatible.
    DirectPlayProfiles: [
      { Container: "hls", Type: "Video", VideoCodec: "hevc,h264", AudioCodec: audioCodecs },
      { Container: "mp4,m4v", Type: "Video", VideoCodec: "hevc,h264", AudioCodec: audioCodecs },
    ],
    TranscodingProfiles: [
      {
        Container: "mp4",
        Type: "Video",
        VideoCodec: "hevc,h264",
        AudioCodec: audioCodecs,
        Protocol: "hls",
        Context: "Streaming",
        // 8 channels is only reachable through a surround codec; asking for it
        // while capped at aac just invites a downmix decision we didn't make.
        MaxAudioChannels: hasSurround ? "8" : "2",
        MinSegments: 2,
        SegmentLength: 1,
        BreakOnNonKeyFrames: true,
      },
    ],
  };
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

export type MediaSubtitleCue = { start: number; end: number; text: string };

function vttTimestampSeconds(value: string): number {
  const parts = value.trim().replace(",", ".").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) return Number.NaN;
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return hours * 3600 + minutes * 60 + seconds;
}

function plainVttText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
}

/** Parse the conservative VTT returned by the Cloud Media gateway without ever
 * registering a text track on the video element (and therefore with AVKit). */
export function parseMediaVtt(value: string): MediaSubtitleCue[] {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block.split("\n");
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) return [];
      const [rawStart, rawEnd = ""] = lines[timingIndex].split("-->");
      const start = vttTimestampSeconds(rawStart);
      const end = vttTimestampSeconds(rawEnd.trim().split(/\s+/)[0] ?? "");
      const text = plainVttText(lines.slice(timingIndex + 1).join("\n").trim());
      return Number.isFinite(start) && Number.isFinite(end) && end > start && text
        ? [{ start, end, text }]
        : [];
    });
}

export function mediaCueTextAt(cues: MediaSubtitleCue[], seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  return cues.filter((cue) => seconds >= cue.start && seconds < cue.end).map((cue) => cue.text).join("\n");
}

/** Use the decoded frame's timestamp when it shares the media element's
 * normalized timeline. Native MPEG-TS HLS can expose a transport/PCR offset in
 * `mediaTime`, so the player detects the clock domain on an owned frame and
 * keeps that choice for the source. A post-seek frame may legitimately differ
 * from currentTime by more than the detection threshold. */
export function subtitleFrameTime(currentTime: number, mediaTime: number, clock: "detect" | "decoded" | "dom" = "detect"): number {
  if (!Number.isFinite(mediaTime)) return currentTime;
  if (!Number.isFinite(currentTime)) return mediaTime;
  if (clock === "decoded") return mediaTime;
  if (clock === "dom") return currentTime;
  return Math.abs(mediaTime - currentTime) <= .5 ? mediaTime : currentTime;
}

export function subtitleLanguageMatches(language?: string, preferred?: string): boolean {
  const normalize = (value?: string) => (value ?? "").toLowerCase().replace("_", "-").replace(/^eng$/, "en").replace(/^(zho|chi|cmn)$/, "zh");
  const actual = normalize(language), wanted = normalize(preferred);
  return Boolean(wanted) && (actual === wanted || wanted === "zh" && actual.startsWith("zh-"));
}

export type WebSubtitleStream = {
  Index: number;
  Type?: string;
  DisplayTitle?: string;
  AiTranslated?: boolean;
  Title?: string;
  Language?: string;
  Codec?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsHearingImpaired?: boolean;
};
type CuratedSubtitleLanguage = "en" | "zh-Hans" | "zh-Hant" | "zh";

function curatedSubtitleLanguage(stream: WebSubtitleStream): CuratedSubtitleLanguage | null {
  const language = (stream.Language ?? "").trim().toLowerCase().replace(/_/g, "-");
  const metadata = [stream.DisplayTitle, stream.Title].filter(Boolean).join(" ");
  // An explicit script tag is stronger evidence than a conflicting generic
  // display label. Generic zho/zh needs the metadata to disambiguate it.
  if (/^(?:zh-hans|zh-cn|zh-sg)$/.test(language)) return "zh-Hans";
  if (/^(?:zh-hant|zh-tw|zh-hk|zh-mo)$/.test(language)) return "zh-Hant";
  if (/^(?:en|eng)$/.test(language)) return "en";
  if (/\bsimplified\b|简体|簡體/i.test(metadata)) return "zh-Hans";
  if (/\btraditional\b|繁体|繁體/i.test(metadata)) return "zh-Hant";
  if (/\benglish\b/i.test(metadata)) return "en";
  if (/^(?:zh|zho|chi|cmn)$/.test(language) || /\b(?:chinese|mandarin)\b|中文/i.test(metadata)) return "zh";
  return null;
}

function subtitleRank(stream: WebSubtitleStream): [number, number, number, number] {
  const metadata = [stream.DisplayTitle, stream.Title].filter(Boolean).join(" ");
  const forced = Boolean(stream.IsForced) || /\bforced\b/i.test(metadata);
  const sdh = Boolean(stream.IsHearingImpaired) || /\b(?:sdh|hearing[ -]?impaired|closed captions?|cc)\b/i.test(metadata);
  return [forced ? 1 : 0, sdh ? 1 : 0, stream.IsDefault ? 0 : 1, stream.Index];
}

function betterSubtitle<T extends WebSubtitleStream>(left: T | undefined, right: T): T {
  if (!left) return right;
  const a = subtitleRank(left), b = subtitleRank(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return b[index] < a[index] ? right : left;
  }
  return left;
}

  /** Defensively curate playback responses that predate gateway subtitle
   * selection. This only trusts track metadata; it does not certify contents. */
export function selectWebSubtitleStreams<T extends WebSubtitleStream>(streams: T[]): T[] {
  const readableCodecs = new Set(["", "srt", "subrip", "vtt", "webvtt", "ass", "ssa", "mov_text", "text"]);
  const selected = new Map<CuratedSubtitleLanguage, T>();
  const automatic: T[] = [];
  for (const stream of streams) {
    if (stream.Type && stream.Type !== "Subtitle") continue;
    if (!readableCodecs.has((stream.Codec ?? "").toLowerCase())) continue;
    if (stream.AiTranslated === true) { automatic.push(stream); continue; }
    const language = curatedSubtitleLanguage(stream);
    if (!language) continue;
    selected.set(language, betterSubtitle(selected.get(language), stream));
  }
  const result: T[] = [];
  for (const language of ["en", "zh-Hans", "zh-Hant"] as const) {
    const stream = selected.get(language);
    if (stream) result.push({ ...stream, Language: language });
  }
  if (!selected.has("zh-Hans") && !selected.has("zh-Hant")) {
    const generic = selected.get("zh");
    if (generic) result.push({ ...generic, Language: "zh" });
  }
  return [...result, ...automatic];
}

export function resolveWebSubtitleIndex<T extends WebSubtitleStream>(
  streams: T[], currentIndex: number | null, preferredLanguage?: string,
): number | null {
  if (currentIndex !== null && streams.some((stream) => stream.Index === currentIndex)) return currentIndex;
  const preferred = streams.find((stream) => subtitleLanguageMatches(stream.Language, preferredLanguage));
  return preferred?.Index ?? streams[0]?.Index ?? null;
}

export function subtitleTrackLabel(stream: {
  DisplayTitle?: string;
  AiTranslated?: boolean;
  Language?: string;
  Title?: string;
  Index: number;
}): string {
  if (stream.AiTranslated === true) return "Chinese (AI)";
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
  const curated = curatedSubtitleLanguage(stream);
  let label = curated === "en" ? "English"
    : curated === "zh-Hans" ? "Chinese Simplified"
      : curated === "zh-Hant" ? "Chinese Traditional"
        : curated === "zh" ? "Chinese"
          : languages.find(([pattern]) => pattern.test(language))?.[1];
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

/** Resolve the next canonical episode from a potentially unsorted Jellyfin
 * response. Completion flows must never use array arrival order: fallback
 * episode requests and mixed-season libraries can return rows out of order. */
export function canonicalNextEpisode<T extends {
  Id: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  Name?: string;
}>(episodes: T[], currentId: string): T | null {
  const ordered = [...episodes].sort((left, right) =>
    (left.ParentIndexNumber ?? 0) - (right.ParentIndexNumber ?? 0)
    || (left.IndexNumber ?? 0) - (right.IndexNumber ?? 0)
    || (left.Name ?? "").localeCompare(right.Name ?? "")
    || left.Id.localeCompare(right.Id));
  const current = ordered.findIndex((episode) => episode.Id === currentId);
  return current >= 0 ? ordered[current + 1] ?? null : null;
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
