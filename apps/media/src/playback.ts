export const progressEvents = [
  "pause",
  "seeked",
  "visibilitychange",
  "pagehide",
  "airplaychange",
  "teardown",
] as const;

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

export function activeCueText(cues: ArrayLike<{ text: string }> | null): string {
  if (!cues) return "";
  return Array.from(cues)
    .map((cue) => cue.text.replace(/<[^>]+>/g, ""))
    .join("\n");
}

const subtitleLanguages: Record<string, string> = {
  chi: "Chinese",
  eng: "English",
  en: "English",
  zh: "Chinese",
  zho: "Chinese",
};

function usableMetadata(value?: string): string | null {
  const normalized = value?.trim();
  if (!normalized || /^(undefined|null|unknown)$/i.test(normalized)) return null;
  return normalized;
}

export function subtitleTrackLabel(stream: { Index: number; DisplayTitle?: string; Language?: string }): string {
  const title = usableMetadata(stream.DisplayTitle);
  if (title) return title;
  const language = usableMetadata(stream.Language);
  if (language) return subtitleLanguages[language.toLowerCase()] ?? language.toUpperCase();
  return `Subtitle ${stream.Index}`;
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
