import { TitleIdentity } from "./TitleIdentity";
import { autoplayAllowed, sameSeasonNext, autoplaySession, saveAutoplaySession } from "./autoplay";
import { usePlayerTouch } from "./usePlayerTouch";
import { recordPlaybackDiagnostic, recordPlaybackFrame } from "./playbackDiagnostics";
import { mediaStorage } from "./profileStorage";
import { SubtitleTimingController, emptyTiming, timingLabel, type SubtitleTimingSessionDraft, type TimingState } from "./subtitleTiming";
import type Hls from "hls.js";
import type { Events, FragLoadedData } from "hls.js";
import { PlaybackGraphs } from "./PlaybackGraphs";
import { appendSample, bufferAhead, downloadMbps, type PlaybackSample } from "./playbackTelemetry";
import {
  Activity,
  Airplay,
  ArrowLeft,
  ArrowRight,
  Captions,
  CaptionsOff,
  ChevronDown,
  ChevronRight,
  Expand,
  ListTree,
  ListVideo,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  Shuffle,
  SlidersHorizontal,
  TriangleAlert,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { Button, Modal } from "@cloud-at-home/ui";
import { airPlayStreamUrl, createStreamTicket, getMediaTimeline, getPlaybackInfo, getSeriesEpisodes, imageUrl, reportPlayback, reportPlaybackEvent, subtitleTrackUrl, ticketedStreamUrl, type MediaItem, type MediaTimeline, type PlaybackInfo, type Session } from "./api";
import { paintRollingTime } from "./rollingTime";
import { ratingBadge, ratingPair } from "./rating";
import { RatingBadgeLabel, ratingBadgeClassName } from "./RatingBadgeLabel";
import { activeCaptionPreset, activeSkippableSegment, airPlayNoticeDurationMs, airPlayUnavailableMessage, audioTrackLabel, canonicalNextEpisode, captionFontSize, captionLineHeight, captionPrefsVersion, captionSizeFlash, captionSizePreset, captionVerticalOffset, claimRatingIntro, classifyStat, formatPlaybackStats, formatSanitizedPlaybackDiagnostics, mediaCueTextAt, fullscreenStrategy, mediaYearLabel, migrateCaptionDefaults, parseMediaVtt, pauseCinemaDelays, pauseSynopsisDurationSeconds, playbackQualityOptions, playbackStartPosition, playerKeyboardAction, playerTitleOwners, prefersViewportFullscreen, ratingDescriptionLines, ratingIntroTimings, recordRatingPlayerExit, resolveWebSubtitleIndex, seekTime, selectWebSubtitleStreams, shortcutFlash, shortcutFlashDurationMs, shouldArmTitleTimer, shouldReportProgress, skipSegmentLabel, subtitleDelayFlash, subtitleDelayStepSeconds, subtitleFrameTime, subtitleTrackLabel, titleDisplayDurationMs, trickplayFrame, type MediaSubtitleCue, type PlaybackQuality, type ShortcutFlash, type TrickplayInfo } from "./playback";

type SafariVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
  webkitPresentationMode?: "inline" | "fullscreen" | "picture-in-picture";
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: "inline" | "fullscreen" | "picture-in-picture") => void;
  getVideoPlaybackQuality?: () => { droppedVideoFrames: number; totalVideoFrames: number };
};

type SafariFullscreenElement = HTMLDivElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type SafariFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

type CaptionPrefs = {
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  phonePortraitOffset: number;
  portraitOffset: number;
  landscapeOffset: number;
  backgroundOpacity: number;
};

const defaultCaptions: CaptionPrefs = { fontSize: 85, fontWeight: 600, lineHeight: 1.49, letterSpacing: 0, phonePortraitOffset: 25, portraitOffset: 12, landscapeOffset: 8, backgroundOpacity: 0.5 };
const playbackPrefsKey = "cloud-media-playback";
const pauseTitleHandoffMs = 500;
type PlaybackPrefs = { autoplay?: boolean; muted: boolean; volume: number; rate?: number; fit?: "contain" | "cover"; subtitleLanguage?: string; subtitlesOff?: boolean; audioLanguage?: string; quality?: PlaybackQuality };
type PlaybackTraceEvent = { at: number; stage: string; detail?: string };

function subtitlePreviewTime(seconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(totalCentiseconds / 360_000);
  const minutes = Math.floor(totalCentiseconds / 6_000) % 60;
  const secondsPart = Math.floor(totalCentiseconds / 100) % 60;
  const centiseconds = totalCentiseconds % 100;
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function bufferedStartupPercent(video: HTMLVideoElement): number {
  const current = video.currentTime;
  let bufferedAhead = 0;
  for (let index = 0; index < video.buffered.length; index += 1) {
    if (video.buffered.start(index) <= current && video.buffered.end(index) >= current) {
      bufferedAhead = video.buffered.end(index) - current;
      break;
    }
  }
  return Math.max(1, Math.min(99, Math.round((bufferedAhead / 8) * 100)));
}

function mediaReadyStartupPercent(readyState: number): number {
  return [68, 78, 86, 94, 99][Math.max(0, Math.min(4, readyState))];
}

function loadPlaybackPrefs(): PlaybackPrefs {
  try {
    const saved = JSON.parse(mediaStorage.getItem(playbackPrefsKey) ?? "{}") as Record<string, unknown>;
    const hadPersistedSubtitleDelay = Object.prototype.hasOwnProperty.call(saved, "subtitleDelay");
    delete saved.subtitleDelay;
    const value = { muted: false, volume: 1, ...saved } as PlaybackPrefs;
    if (!/^(best|balanced|data-saver)$/.test(value.quality ?? "")) value.quality = "best";
    if (hadPersistedSubtitleDelay) mediaStorage.setItem(playbackPrefsKey, JSON.stringify(value));
    return value;
  }
  catch { return { muted: false, volume: 1 }; }
}

export function Player({ item, session, fromBeginning = false, historyEnabled = true, movieCandidates = [], onPlayEpisode, onReplay, onSurprise, onClose }: { item: MediaItem; session: Session; fromBeginning?: boolean; historyEnabled?: boolean; movieCandidates?: MediaItem[]; onPlayEpisode?: (episode: MediaItem) => void; onReplay?: () => void; onSurprise?: () => void; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const shellRef = useRef<SafariFullscreenElement>(null);
  const videoRef = useRef<SafariVideo>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const airPlayUrlRef = useRef<string | null>(null);
  const subtitleCuesRef = useRef<MediaSubtitleCue[]>([]);
  const subtitleClockRef = useRef<{ seconds: number; source: "DOM currentTime" | "Decoded frame timestamp" }>({ seconds: 0, source: "DOM currentTime" });
  const decodedFrameClockRef = useRef<"detect" | "decoded" | "dom">("detect");
  const subtitleClockEpochRef = useRef(0);
  const mediaSeekingRef = useRef(false);
  const subtitleLoadIdRef = useRef(0);
  const fullscreenIntentRef = useRef(false);
  const toggleFullscreenRef = useRef<() => void>(() => undefined);
  const initialPlayPendingRef = useRef(true);
  const lastReport = useRef(0);
  const positionRef = useRef(fromBeginning ? 0 : (item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000);
  const stoppedRef = useRef(false);
  const reportQueueRef = useRef<Promise<void>>(Promise.resolve());
  const traceStartedAtRef = useRef(Date.now());
  const playbackTraceRef = useRef<PlaybackTraceEvent[]>([{ at: 0, stage: "play-command" }]);
  const transportTimerRef = useRef<number | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const titleTimerRef = useRef<number | null>(null);
  const seekingRef = useRef(false);
  const seekTargetRef = useRef<number | null>(null);
  // Live-scrub: while dragging we coalesce seeks to one per animation frame so
  // an HLS transcode is not hammered with a new seek on every input event.
  const scrubRafRef = useRef<number | null>(null);
  const scrubPendingRef = useRef<number | null>(null);
  const [info, setInfo] = useState<PlaybackInfo | null>(null);
  const [qualityPreference, setQualityPreference] = useState<PlaybackQuality>(() => loadPlaybackPrefs().quality ?? "best");
  const [audioIndex, setAudioIndex] = useState<number | null>(null);
  const [switchingPlayback, setSwitchingPlayback] = useState(false);
  const [startupStage, setStartupStage] = useState<"preparing" | "starting" | "buffering" | null>("preparing");
  const [startupProgress, setStartupProgress] = useState(8);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [endCountdown, setEndCountdown] = useState<number | null>(null);
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const hasPlaybackStartedRef = useRef(false);
  // Playback-start classification cards: Canadian classification first, then
  // the U.S. rating. Do not start the sequence until the media element has
  // genuinely entered `playing`; slow transcodes must not spend the cards on
  // a black loading screen.
  const ratingCards = useMemo(() => ratingPair(item.OfficialRating || "", item.Classifications), [item.OfficialRating, item.Classifications]);
  const [ratingCard, setRatingCard] = useState<number | null>(null);
  const ratingIntroEligible = useRef<boolean | null>(null);
  useEffect(() => () => recordRatingPlayerExit(item.Id), [item.Id]);
  useEffect(() => {
    if (!hasPlaybackStarted || !ratingCards.length) return;
    if (ratingIntroEligible.current === null) ratingIntroEligible.current = claimRatingIntro(item.Id) || fromBeginning;
    if (!ratingIntroEligible.current) return;
    const startedAt = Date.now();
    const timers = ratingIntroTimings(ratingCards.length).flatMap(({ index, showAtMs, hideAtMs }) => [
      window.setTimeout(() => {
        if (Date.now() - startedAt < hideAtMs) setRatingCard(index);
      }, showAtMs),
      window.setTimeout(() => setRatingCard(null), hideAtMs),
    ]);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      setRatingCard(null);
    };
  }, [hasPlaybackStarted, ratingCards, item.Id]);
  const playbackPrefs = useRef(loadPlaybackPrefs());
  const [muted, setMuted] = useState(playbackPrefs.current.muted);
  const [autoplay, setAutoplay] = useState(playbackPrefs.current.autoplay === true);
  const autoSession = useRef(autoplaySession());
  const autoLaunched = useRef(false);
  const autoCancelled = useRef(false);
  const [autoBlocked, setAutoBlocked] = useState(false);
  const movieTarget = movieCandidates.find(candidate => candidate.Type === "Movie" && candidate.Id !== item.Id && !autoSession.current.visited.includes(candidate.Id));

  // Native media volume is capped at 100%; boosts are re-enabled by an explicit
  // user gesture each session so browsers never suspend the audio graph silently.
  const initialVolume = Math.min(1, Math.max(0, playbackPrefs.current.volume));
  const volumeRef = useRef(initialVolume);
  const [volume, setVolume] = useState(initialVolume);
  const [position, setPosition] = useState(fromBeginning ? 0 : (item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000);
  const [duration, setDuration] = useState((item.RunTimeTicks ?? 0) / 10_000_000);
  const [controls, setControls] = useState(true);
  // The top title/year block lingers a beat after the rest of the chrome fades,
  // then fades on its own — so the picture clears in two calm stages, not one.
  const [titleLingering, setTitleLingering] = useState(true);
  const [transportHover, setTransportHover] = useState(false);
  const [settings, setSettings] = useState<"captions" | "playback" | "episodes" | "chapters" | null>(null);
  const [timingExpanded, setTimingExpanded] = useState<boolean | null>(null);
  const [seriesEpisodes, setSeriesEpisodes] = useState<MediaItem[]>([]);
  const [timeline, setTimeline] = useState<MediaTimeline>({ chapters: [], segments: [] });
  const nextEpisode = useMemo(() => canonicalNextEpisode(seriesEpisodes, item.Id), [item.Id, seriesEpisodes]);
  const autoplayTarget = item.Type === "Episode"
    ? sameSeasonNext(item, nextEpisode) ? nextEpisode : null
    : movieTarget ?? null;

  const activeSegment = useMemo(() => activeSkippableSegment(timeline.segments, position), [position, timeline.segments]);
  const [captions, setCaptions] = useState<CaptionPrefs>(() => {
    try {
      const saved = migrateCaptionDefaults(JSON.parse(mediaStorage.getItem("cloud-media-captions") ?? "{}"));
      const legacyOffset = saved.offset == null ? undefined : captionVerticalOffset(saved.offset);
      return {
        ...defaultCaptions,
        ...saved,
        fontSize: captionFontSize(saved.fontSize),
        lineHeight: captionLineHeight(saved.lineHeight),
        phonePortraitOffset: captionVerticalOffset(saved.phonePortraitOffset ?? defaultCaptions.phonePortraitOffset),
        portraitOffset: captionVerticalOffset(saved.portraitOffset ?? legacyOffset ?? defaultCaptions.portraitOffset),
        // A portrait-safe legacy value can land halfway up the picture after
        // rotation. Start landscape lower, then remember both independently.
        landscapeOffset: captionVerticalOffset(saved.landscapeOffset ?? (legacyOffset == null ? defaultCaptions.landscapeOffset : Math.min(legacyOffset, 12))),
      };
    }
    catch { return defaultCaptions; }
  });
  const [smartphoneLandscape, setSmartphoneLandscape] = useState(() => window.matchMedia("(orientation: landscape) and (max-height: 600px)").matches);
  const [phonePortrait, setPhonePortrait] = useState(() => window.matchMedia("(orientation: portrait) and (max-width: 520px)").matches);
  const [playbackRate, setPlaybackRate] = useState(playbackPrefs.current.rate ?? 1);
  const [videoFit, setVideoFit] = useState<"contain" | "cover">(playbackPrefs.current.fit ?? "contain");
  const [pauseCinema, setPauseCinema] = useState(false);
  const [pauseTitleHandoff, setPauseTitleHandoff] = useState(false);
  const [pauseFrame, setPauseFrame] = useState("");
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null);
  // Read inside the per-frame cue loop, so it lives in a ref as well as state:
  // the loop closes over its effect's render and would otherwise keep nudging
  // against a stale delay until something else re-armed it.
  const subtitleDelayRef = useRef(0);
  const timingController = useRef<SubtitleTimingController | null>(null);
  // Player-session only: a draft survives closing settings, focus refreshes,
  // and turning the same track off and back on. The Player key changes when a
  // title changes, so it cannot leak into another movie.
  const subtitleTimingDrafts = useRef(new Map<string, SubtitleTimingSessionDraft>());
  const [subtitleTiming, setSubtitleTiming] = useState<TimingState>({ ...emptyTiming });
  useEffect(() => () => timingController.current?.dispose(), []);
  useEffect(() => {
    if (settings === "captions") void timingController.current?.refresh();
  }, [settings]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void timingController.current?.refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => {
    subtitleTimingDrafts.current.clear();
  }, [item.Id]);
  const [cue, setCue] = useState("");
  const cueRef = useRef("");
  const [subtitleRenderEpoch, setSubtitleRenderEpoch] = useState(0);
  const [seekPreview, setSeekPreview] = useState<{ time: number; left: number } | null>(null);
  const [seeking, setSeeking] = useState(false);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [errorSeverity, setErrorSeverity] = useState<"warning" | "error">("error");
  const [notice, setNotice] = useState("");
  // Keyed so repeat presses of the same key restart the animation instead of
  // leaving the first badge sitting there unchanged.
  const [flash, setFlash] = useState<(ShortcutFlash & { key: number }) | null>(null);
  const flashKeyRef = useRef(0);
  const showFlash = useCallback((next: ShortcutFlash | null) => {
    if (!next) return;
    flashKeyRef.current += 1;
    setFlash({ ...next, key: flashKeyRef.current });
  }, []);
  const [statsOpen, setStatsOpen] = useState(false);
  const [viewportFullscreen, setViewportFullscreen] = useState(false);
  const [statsSamples, setStatsSamples] = useState<PlaybackSample[]>([]);

  function showError(message: string, severity: "warning" | "error" = "error") {
    setErrorSeverity(severity);
    setError(message);
  }

  function dismissError() {
    setError("");
  }

  const source = info?.MediaSources?.[0];
  const yearLabel = mediaYearLabel(item);
  const pauseTitle = item.SeriesName ?? item.Name;
  const pauseTitleBreak = pauseTitle.lastIndexOf(" ");
  const pauseTitleLead = pauseTitleBreak > 0 ? pauseTitle.slice(0, pauseTitleBreak + 1) : "";
  const pauseTitleTail = pauseTitleBreak > 0 ? pauseTitle.slice(pauseTitleBreak + 1) : pauseTitle;
  const pauseDelays = pauseCinemaDelays(Boolean(item.SeriesName));
  const titleOwners = playerTitleOwners(pauseCinema, titleLingering, pauseTitleHandoff);
  // Every path that raises the corner title goes through here, so showing it
  // and scheduling its exit can never come apart. `titleTimerRef` is the one
  // record of a pending hide: null means nothing will take the title down.
  const showTitle = useCallback((armHide: boolean) => {
    setTitleLingering(true);
    if (titleTimerRef.current !== null) window.clearTimeout(titleTimerRef.current);
    titleTimerRef.current = armHide
      ? window.setTimeout(() => { titleTimerRef.current = null; setTitleLingering(false); }, titleDisplayDurationMs)
      : null;
  }, []);
  const captionOffset = smartphoneLandscape ? captions.landscapeOffset : phonePortrait ? captions.phonePortraitOffset : captions.portraitOffset;
  const subtitles = useMemo(() => selectWebSubtitleStreams(source?.MediaStreams ?? []), [source]);
  const audioStreams = useMemo(() => source?.MediaStreams?.filter((stream) => stream.Type === "Audio") ?? [], [source]);
  const videoStream = source?.MediaStreams?.find((stream) => stream.Type === "Video");
  const subtitleStream = subtitles.find((stream) => stream.Index === subtitleIndex);
  const audioStream = audioStreams.find((stream) => stream.Index === audioIndex)
    ?? audioStreams.find((stream) => stream.IsDefault)
    ?? audioStreams[0];
  const video = videoRef.current;
  const playerBounds = shellRef.current?.getBoundingClientRect();
  const quality = video?.getVideoPlaybackQuality?.();
  const hls = hlsRef.current;
  const hlsLevel = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : undefined;
  const captionTime = subtitleClockRef.current.seconds - subtitleDelayRef.current;
  const activeSubtitleCues = statsOpen && subtitleStream
    ? subtitleCuesRef.current.filter((activeCue) => captionTime >= activeCue.start && captionTime < activeCue.end)
    : [];
  const subtitleSyncPreview = useMemo(() => {
    if (settings !== "captions" || !subtitleStream || subtitleCuesRef.current.length === 0) return [];
    const cueTime = subtitleClockRef.current.seconds - subtitleTiming.delay;
    const cues = subtitleCuesRef.current;
    const activeIndex = cues.findIndex((entry) => cueTime >= entry.start && cueTime < entry.end);
    const nextIndex = cues.findIndex((entry) => entry.start > cueTime);
    const indices = activeIndex >= 0
      ? [activeIndex, activeIndex + 1]
      : nextIndex < 0 ? [cues.length - 1] : [Math.max(0, nextIndex - 1), nextIndex];
    return [...new Set(indices.filter((index) => index >= 0 && index < cues.length))].map((index) => {
      const entry = cues[index]!;
      return {
        entry,
        active: cueTime >= entry.start && cueTime < entry.end,
        relation: cueTime >= entry.start && cueTime < entry.end ? "Now" : entry.end <= cueTime ? "Previous" : "Next",
      };
    });
  }, [cue, position, settings, subtitleStream?.Index, subtitleTiming.delay]);
  const recordTrace = useCallback((stage: string, detail?: string) => {
    const trace = playbackTraceRef.current;
    const at = Date.now() - traceStartedAtRef.current;
    trace.push({ at, stage, detail });
    if (trace.length > 80) trace.splice(0, trace.length - 80);
    void reportPlaybackEvent({ itemId: item.Id, event: stage, elapsedMs: at, detail }).catch(() => undefined);
  }, [item.Id]);
  useEffect(() => {
    void reportPlaybackEvent({ itemId: item.Id, event: "play-command", elapsedMs: 0 }).catch(() => undefined);
  }, [item.Id]);
  const bufferedSeconds = video ? bufferAhead(video.buffered, video.currentTime) : 0;
  const playbackStats = formatPlaybackStats({
    width: video?.videoWidth || videoStream?.Width,
    height: video?.videoHeight || videoStream?.Height,
    viewportWidth: playerBounds ? Math.round(playerBounds.width) : undefined,
    viewportHeight: playerBounds ? Math.round(playerBounds.height) : undefined,
    mode: source?.TranscodingUrl ? "Transcoding" : "Direct play",
    engine: hls ? "hls.js" : "Native media element",
    container: source?.Container,
    videoCodec: videoStream?.Codec,
    videoProfile: videoStream?.Profile,
    bitDepth: videoStream?.BitDepth,
    frameRate: videoStream?.RealFrameRate ?? videoStream?.AverageFrameRate,
    videoBitrate: videoStream?.BitRate,
    audioCodec: audioStream?.Codec,
    audioChannels: audioStream?.Channels,
    sampleRate: audioStream?.SampleRate,
    audioBitrate: audioStream?.BitRate,
    position: video?.currentTime,
    duration: video?.duration,
    captionTime: subtitleStream ? captionTime : undefined,
    captionClockSource: subtitleStream ? subtitleClockRef.current.source : undefined,
    subtitleCueStart: activeSubtitleCues.length ? Math.min(...activeSubtitleCues.map((activeCue) => activeCue.start)) : undefined,
    subtitleCueEnd: activeSubtitleCues.length ? Math.max(...activeSubtitleCues.map((activeCue) => activeCue.end)) : undefined,
    bufferedSeconds,
    droppedFrames: quality?.droppedVideoFrames,
    totalFrames: quality?.totalVideoFrames,
    bandwidth: hls?.bandwidthEstimate,
    hlsLevel: hlsLevel ? `${hlsLevel.width} × ${hlsLevel.height}${hlsLevel.bitrate ? ` · ${(hlsLevel.bitrate / 1_000_000).toFixed(1)} Mbps` : ""}` : undefined,
    readyState: video?.readyState,
    networkState: video?.networkState,
    rate: playbackRate,
    subtitleTrack: subtitleStream ? subtitleTrackLabel(subtitleStream) : undefined,
    subtitleDelay: subtitleStream ? subtitleDelayRef.current : undefined,
    subtitleCue: subtitleStream ? cue : undefined,
  });
  useEffect(() => {
    if (!statsOpen) return;
    setStatsSamples([]);
    let attached: Hls | null = null;
    let transfer: { at: number; speed: number | null } | null = null;
    const event = "hlsFragLoaded" as Events.FRAG_LOADED;
    const loaded = (_event: Events.FRAG_LOADED, data: FragLoadedData) => {
      const stats = data.part?.stats ?? data.frag.stats;
      transfer = { at: performance.now(), speed: downloadMbps(stats.loaded, stats.loading.end - stats.loading.start) };
    };
    const sample = () => {
      if (attached !== hlsRef.current) {
        attached?.off(event, loaded);
        attached = hlsRef.current;
        attached?.on(event, loaded);
        transfer = null;
      }
      const current = videoRef.current;
      const at = performance.now();
      setStatsSamples((previous) => appendSample(previous, {
        at, buffer: current ? bufferAhead(current.buffered, current.currentTime) : 0,
        download: transfer && at - transfer.at < 10_000 ? transfer.speed : null,
      }));
    };
    sample();
    const timer = window.setInterval(sample, 1_000);
    return () => { window.clearInterval(timer); attached?.off(event, loaded); };
  }, [statsOpen, item.Id, info?.PlaySessionId]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), airPlayNoticeDurationMs);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), shortcutFlashDurationMs);
    return () => window.clearTimeout(timer);
  }, [flash]);
  useEffect(() => {
    if (!startupStage || (hasPlaybackStarted && !switchingPlayback && startupStage !== "buffering")) return;
    const timer = window.setTimeout(() => {
      recordTrace("timeout", startupStage);
      setStartupStage(null);
      setSwitchingPlayback(false);
      showError(`Stream timed out while ${startupStage === "preparing" ? "preparing playback" : startupStage === "starting" ? "starting" : "buffering"}.`);
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [hasPlaybackStarted, recordTrace, startupStage, switchingPlayback]);
  useEffect(() => () => {
    if (transportTimerRef.current !== null) window.clearTimeout(transportTimerRef.current);
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
    if (titleTimerRef.current !== null) window.clearTimeout(titleTimerRef.current);
    if (scrubRafRef.current !== null) window.cancelAnimationFrame(scrubRafRef.current);
    if (audioContextRef.current) void audioContextRef.current.close().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!item.SeriesId) { setSeriesEpisodes([]); return; }
    let cancelled = false;
    void getSeriesEpisodes(item.SeriesId, session.user.id)
      .then((episodes) => {
        if (cancelled) return;
        setSeriesEpisodes(episodes.map((episode) => ({
          ...episode,
          SeriesId: episode.SeriesId ?? item.SeriesId,
          SeriesName: episode.SeriesName ?? item.SeriesName,
          SeriesProductionYear: item.SeriesProductionYear,
          SeriesEndDate: item.SeriesEndDate,
        })));
      })
      .catch(() => { if (!cancelled) setSeriesEpisodes([]); });
    return () => { cancelled = true; };
  }, [item.SeriesEndDate, item.SeriesId, item.SeriesName, item.SeriesProductionYear, session.user.id]);
  useEffect(() => {
    const activity = () => { if (ended) { autoCancelled.current = true; setEndCountdown(null); } autoSession.current = { lastActivity: Date.now(), consecutive: 0, visited: [] }; saveAutoplaySession(autoSession.current); };
    const hidden = () => { if (document.hidden) { if (ended) autoCancelled.current = true; setEndCountdown(null); } };
    document.addEventListener("pointerdown", activity);
    document.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("pointerdown", activity); document.removeEventListener("keydown", activity); document.removeEventListener("visibilitychange", hidden); };
  }, [ended]);
  function canAutoplay() {
    return !autoCancelled.current && autoplayAllowed({ enabled: autoplay, visible: !document.hidden, completed: ended, failed: Boolean(error),
      currentId: item.Id, nextId: autoplayTarget?.Id ?? null, now: Date.now(), ...autoSession.current });
  }
  useEffect(() => {
    if (!canAutoplay()) { setEndCountdown(null); setAutoBlocked(Boolean(ended && autoplay && autoplayTarget)); return; }
    setAutoBlocked(false);
    setEndCountdown(8);
    const deadline = Date.now() + 8000;
    const timer = window.setInterval(() => {
      if (!canAutoplay() || Date.now() > deadline + 3000) { setEndCountdown(null); window.clearInterval(timer); return; }
      setEndCountdown(value => value === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [ended, autoplay, autoplayTarget?.Id, error]);
  useEffect(() => {
    if (endCountdown !== 0 || autoLaunched.current || !canAutoplay() || !autoplayTarget || !onPlayEpisode) return;
    autoLaunched.current = true;
    autoSession.current.consecutive += 1;
    autoSession.current.visited.push(item.Id);
    saveAutoplaySession(autoSession.current);
    playEpisode(autoplayTarget);
  }, [endCountdown, ended, autoplayTarget?.Id, onPlayEpisode]);
  useEffect(() => {
    if (!ended) return;
    const frame = window.requestAnimationFrame(() => shellRef.current?.querySelector<HTMLButtonElement>(".player-end-screen button")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [ended]);
  const trickplay = useMemo(() => {
    const manifests = source?.Trickplay;
    if (!manifests) return null;
    const widths = manifests[item.Id] ?? Object.values(manifests)[0];
    const entries = Object.entries(widths ?? {}).sort(([left], [right]) => Number(left) - Number(right));
    if (!entries.length) return null;
    const preferred = entries.filter(([width]) => Number(width) <= 320);
    const [width, details] = preferred[preferred.length - 1] ?? entries[0];
    return { width: Number(width), details };
  }, [item.Id, source?.Trickplay]);
  const payload = useCallback(() => ({
    ItemId: item.Id,
    MediaSourceId: source?.Id,
    PlaySessionId: info?.PlaySessionId,
    PositionTicks: Math.round((videoRef.current?.currentTime ?? positionRef.current) * 10_000_000),
    IsPaused: videoRef.current?.paused ?? true,
    IsMuted: videoRef.current?.muted ?? false,
    VolumeLevel: Math.round((videoRef.current?.volume ?? 1) * 100),
    PlayMethod: source?.TranscodingUrl ? "Transcode" : "DirectPlay",
    CanSeek: true,
  }), [info?.PlaySessionId, item.Id, source?.Id, source?.TranscodingUrl]);

  const enqueueReport = useCallback((event: "start" | "progress" | "stop", keepalive = false) => {
    if (!historyEnabled) return Promise.resolve();
    const snapshot = payload();
    const request = () => reportPlayback(event, snapshot, keepalive, historyEnabled).catch(() => undefined);
    reportQueueRef.current = reportQueueRef.current.then(request, request);
    return reportQueueRef.current;
  }, [historyEnabled, payload]);

  useEffect(() => {
    const probe = videoRef.current;
    const supportsHevc = Boolean(probe?.canPlayType('video/mp4; codecs="hvc1"'));
    // Ask about the AUDIO codecs directly instead of inferring them from the
    // HEVC answer. Safari says "probably" to hvc1 and nothing to ac-3/ec-3,
    // which is exactly the pair of answers the old single-probe version threw
    // away — and why every re-encoded title came back as undecodable AC-3.
    const audio = {
      ac3: Boolean(probe?.canPlayType('audio/mp4; codecs="ac-3"')),
      eac3: Boolean(probe?.canPlayType('audio/mp4; codecs="ec-3"')),
    };
    let cancelled = false;
    recordTrace("playback-info-start", `quality=${qualityPreference};audio=${audioIndex ?? "default"}`);
    setStartupStage("preparing");
    setStartupProgress(12);
    getPlaybackInfo(item.Id, supportsHevc, audio, {
      quality: qualityPreference,
      audioStreamIndex: audioIndex ?? undefined,
    }).then((playback) => {
      if (cancelled) return;
      setInfo(playback);
      const selectedSource = playback.MediaSources?.[0];
      recordTrace("playback-info-end", selectedSource?.TranscodingUrl ? "hls" : "bounded-stream");
      setStartupStage("starting");
      setStartupProgress(34);
      dismissError();
    }).catch((reason) => {
      if (cancelled) return;
      recordTrace("playback-info-error", String(reason.message ?? reason));
      setSwitchingPlayback(false);
      setStartupStage(null);
      showError(String(reason.message ?? reason));
    });
    return () => { cancelled = true; };
  }, [audioIndex, item.Id, playbackAttempt, qualityPreference, recordTrace, session.user.id]);

  useEffect(() => {
    let cancelled = false;
    getMediaTimeline(item.Id).then((value) => {
      if (!cancelled) setTimeline(value);
    }).catch(() => {
      if (!cancelled) setTimeline({ chapters: [], segments: [] });
    });
    return () => { cancelled = true; };
  }, [item.Id]);

  useEffect(() => {
    if (!source || !videoRef.current) return;
    const video = videoRef.current;
    decodedFrameClockRef.current = "detect";
    stoppedRef.current = false;
    initialPlayPendingRef.current = true;
    let cancelled = false;
    let initialPlayAttempts = 0;
    let retryTimer: number | null = null;
    let waitingForCanPlay = false;
    const maxInitialPlayAttempts = 4;
    const paintPausedFrame = () => {
      if (!cancelled && hasPlaybackStartedRef.current && video.paused) setPauseFrame(captureVideoFrame(video));
    };
    const markInitialPlayStarted = () => { initialPlayPendingRef.current = false; };
    const retryWhenPlayable = () => {
      waitingForCanPlay = false;
      scheduleInitialPlayRetry(false);
    };
    const scheduleInitialPlayRetry = (waitForCanPlay: boolean) => {
      if (cancelled || !initialPlayPendingRef.current || !video.paused || retryTimer !== null) return;
      if (initialPlayAttempts >= maxInitialPlayAttempts) {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) paintPausedFrame();
        else video.addEventListener("loadeddata", paintPausedFrame, { once: true });
        return;
      }
      if (waitForCanPlay && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        if (!waitingForCanPlay) {
          waitingForCanPlay = true;
          video.addEventListener("canplay", retryWhenPlayable, { once: true });
        }
        return;
      }
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        startPlayback();
      }, 0);
    };
    const startPlayback = () => {
      if (cancelled) return;
      initialPlayAttempts += 1;
      void startVideoPlayback(video).catch(() => {
        // Safari can abort the first play while a ticketed source or resume seek
        // is still settling. A later `play` event is not success: WebKit can
        // emit play -> pause without ever advancing a frame. Keep the original
        // command pending until `playing`, and recover both rejected plays and
        // setup-time pauses without touching deliberate pauses after startup.
        scheduleInitialPlayRetry(true);
      });
    };
    const recoverInterruptedInitialPlay = () => scheduleInitialPlayRetry(false);
    const startAfterResume = () => startPlayback();
    const applyResume = () => {
      const target = playbackStartPosition(positionRef.current, video.duration, !hasPlaybackStartedRef.current && fromBeginning);
      if (target > 0 && Math.abs(video.currentTime - target) > .05) {
        video.addEventListener("seeked", startAfterResume, { once: true });
        video.currentTime = target;
        positionRef.current = target;
        return;
      }
      startPlayback();
    };
    recordTrace("stream-ticket-start");
    void createStreamTicket(item.Id).then(async (ticket) => {
      if (cancelled) return;
      recordTrace("stream-ticket-end");
      setStartupProgress(52);
      const direct = `Videos/${item.Id}/stream?static=true&mediaSourceId=${encodeURIComponent(source.Id)}`;
      const target = source.TranscodingUrl?.replace(/^\//, "") ?? direct;
      const url = ticketedStreamUrl(ticket.ticket, target);
      airPlayUrlRef.current = airPlayStreamUrl(ticket, target);
      if (url.includes(".m3u8") && !video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native-HLS clients (notably iPhone/iPad) never need hls.js. Keep its
        // 500+ KB module out of the home-page dependency graph and load it only
        // when a desktop-class browser actually begins HLS playback.
        const { default: HlsRuntime } = await import("hls.js");
        if (cancelled) return;
        if (HlsRuntime.isSupported()) {
          const hls = new HlsRuntime({ enableWorker: true, backBufferLength: 90, renderTextTracksNatively: false });
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(HlsRuntime.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            recordTrace("stream-error", data.details);
            showError(data.details);
          });
          hlsRef.current = hls;
        } else {
          video.src = url;
        }
      } else {
        video.src = url;
      }
      recordTrace("stream-attached", url.includes(".m3u8") ? "hls" : "bounded-stream");
      setStartupProgress(68);
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) applyResume();
      else video.addEventListener("loadedmetadata", applyResume, { once: true });
      void enqueueReport("start");
    }).catch((reason) => {
      recordTrace("stream-ticket-error", reason instanceof Error ? reason.message : String(reason));
      setSwitchingPlayback(false);
      setStartupStage(null);
      showError(reason instanceof Error ? reason.message : "Could not create playback session");
    });
    // NATIVE playback failures were silent. The hls.js branch above reports its
    // fatal errors through setError, but the `video.src = url` branch — which
    // is the one every iOS device takes, because canPlayType('…mpegurl') is
    // truthy there — had no error listener at all. A native decode/network
    // failure just left the player sitting there with nothing on screen and
    // nothing in the console, which is unfalsifiable from the outside.
    const reportNativeError = () => {
      const err = video.error;
      if (!err) return;
      recordTrace("media-error", `${err.code}`);
      showError({
        1: "Playback was aborted.",
        2: "Network error while streaming — the connection dropped.",
        3: "This file could not be decoded on this device.",
        4: "This device can't play this stream format.",
      }[err.code] ?? `Playback failed (media error ${err.code}).`);
    };
    video.addEventListener("error", reportNativeError);
    video.addEventListener("playing", markInitialPlayStarted);
    video.addEventListener("pause", recoverInterruptedInitialPlay);
    return () => {
      video.removeEventListener("error", reportNativeError);
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      video.removeEventListener("loadedmetadata", applyResume);
      video.removeEventListener("loadeddata", paintPausedFrame);
      video.removeEventListener("canplay", retryWhenPlayable);
      video.removeEventListener("seeked", startAfterResume);
      video.removeEventListener("playing", markInitialPlayStarted);
      video.removeEventListener("pause", recoverInterruptedInitialPlay);
      if (!stoppedRef.current) {
        stoppedRef.current = true;
        void enqueueReport("stop", true);
      }
      hlsRef.current?.destroy();
      hlsRef.current = null;
      airPlayUrlRef.current = null;
    };
    // A fresh play-session identity is also a lifecycle boundary when quality
    // or audio changes while Jellyfin keeps the same media-source id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.Id, info?.PlaySessionId, fromBeginning, recordTrace]);

  const report = useCallback((force = false) => {
    const video = videoRef.current;
    if (!video || !info) return;
    if (force || shouldReportProgress({ previous: lastReport.current, current: video.currentTime, paused: video.paused })) {
      lastReport.current = video.currentTime;
      void enqueueReport("progress");
    }
  }, [enqueueReport, info]);

  useEffect(() => {
    const onVisibility = () => document.hidden && report(true);
    const onPageHide = () => { if (!stoppedRef.current) void enqueueReport("progress", true); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [enqueueReport, report]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (settings) return;
      // Let the user type into text fields unhindered. Player sliders are not
      // typing surfaces: a focused seek/volume range must not disable every
      // shortcut for the rest of the session.
      const target = event.target as HTMLElement | null;
      const playerRange = target instanceof HTMLInputElement
        && target.type === "range"
        && Boolean(target.closest(".player-shell"));
      if (target && !playerRange && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const video = videoRef.current;
      if (!video) return;
      const key = event.key;
      const shortcut = playerKeyboardAction(key, event.code);
      const captionsActive = Boolean(subtitleStream);
      const ownsDigit = /^[0-9]$/.test(key);
      // Only claim -/+/= when there is a caption to resize; otherwise leave them
      // to the browser so they are not silently eaten to no effect.
      const ownsFontKey = captionsActive && (key === "-" || key === "+" || key === "=" || key === "_");
      const isOwned = shortcut !== null || ownsDigit || ownsFontKey;
      if (isOwned) event.preventDefault();
      if (shortcut === "toggle" && event.repeat) return;
      // Any handled shortcut wakes the chrome, then lets it auto-hide again.
      if (isOwned) {
        setControls(true);
        if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
        controlsTimerRef.current = window.setTimeout(() => setControls(false), 2_800);
        // While paused, pause cinema owns the title handoff. An independent
        // timer can clear the corner title several seconds too early.
        showTitle(!video.paused);
      }

      if (shortcut === "seek-back") seekBy(-10, video);
      else if (shortcut === "seek-forward") seekBy(10, video);
      else if (shortcut === "toggle") video.paused ? void startVideoPlayback(video) : pauseVideoPlayback(video);
      else if (shortcut === "fullscreen") toggleFullscreenRef.current();
      else if (shortcut === "mute") video.muted = !video.muted;
      else if (shortcut === "volume-up") changeVolume(volumeRef.current + 0.05);
      else if (shortcut === "volume-down") changeVolume(volumeRef.current - 0.05);
      else if (shortcut === "captions") {
        // No subtitle tracks: nothing toggles, so nothing should flash either.
        if (!subtitles.length) return;
        if (captionsActive) void chooseSubtitle(null);
        else {
          void chooseSubtitle(resolveWebSubtitleIndex(subtitles, null, playbackPrefs.current.subtitleLanguage));
        }
      }
      else if (shortcut === "subtitle-earlier" || shortcut === "subtitle-later") {
        // Nothing on screen to move, and no silent state change either.
        if (!captionsActive) return;
        if (!timingController.current?.state.ready) return;
        if (!timingController.current.adjust(shortcut === "subtitle-later" ? subtitleDelayStepSeconds : -subtitleDelayStepSeconds)) return;
        // Repaint against the new delay now: while paused there is no frame
        // loop running to pick it up, so the nudge would look like it did
        // nothing until the next play or seek.
        showFlash(subtitleDelayFlash(subtitleDelayRef.current));
        syncSubtitleAtOwnedClock();
        return;
      }
      else if (ownsFontKey) {
        const step = (key === "+" || key === "=") ? 5 : -5;
        setCaptions((current) => {
          const fontSize = captionFontSize(current.fontSize + step);
          showFlash(captionSizeFlash(fontSize));
          return { ...current, fontSize };
        });
      }

      // Flash reports the state the shortcut PRODUCED, so it is read after the
      // branch above ran. `muted`/`paused` are already settled on the element;
      // captions flip asynchronously via chooseSubtitle, so that one is
      // predicted from the toggle rather than re-read.
      if (shortcut) {
        showFlash(shortcutFlash(shortcut, {
          paused: video.paused,
          muted: video.muted,
          volume: video.muted ? 0 : volumeRef.current,
          captionsActive: shortcut === "captions" ? !captionsActive : captionsActive,
        }));
      }
      else if (ownsDigit) {
        const seconds = (video.duration || duration) * (Number(key) / 10);
        if (Number.isFinite(seconds)) video.currentTime = seconds;
      }
    };
    // Capture before WebKit's native media/range handlers consume Space or an
    // arrow key. This matters for hardware keyboards attached to an iPad.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [settings, showTitle, subtitleStream, subtitles, duration, playing]);

  useEffect(() => {
    mediaStorage.setItem("cloud-media-captions", JSON.stringify({ ...captions, version: captionPrefsVersion }));
  }, [captions]);

  useEffect(() => {
    const landscapeQuery = window.matchMedia("(orientation: landscape) and (max-height: 600px)");
    const phonePortraitQuery = window.matchMedia("(orientation: portrait) and (max-width: 520px)");
    const syncOrientation = () => {
      setSmartphoneLandscape(landscapeQuery.matches);
      setPhonePortrait(phonePortraitQuery.matches);
    };
    landscapeQuery.addEventListener("change", syncOrientation);
    phonePortraitQuery.addEventListener("change", syncOrientation);
    syncOrientation();
    return () => {
      landscapeQuery.removeEventListener("change", syncOrientation);
      phonePortraitQuery.removeEventListener("change", syncOrientation);
    };
  }, []);

  useEffect(() => {
    if (!source || !videoRef.current) return;
    const video = videoRef.current;
    video.volume = Math.min(1, Math.max(0, playbackPrefs.current.volume));
    video.muted = playbackPrefs.current.muted;
    video.defaultPlaybackRate = playbackPrefs.current.rate ?? 1;
    video.playbackRate = video.defaultPlaybackRate;
    if (playbackPrefs.current.subtitlesOff || !subtitles.length) return;
    chooseSubtitle(resolveWebSubtitleIndex(subtitles, null, playbackPrefs.current.subtitleLanguage));
    // Restore once for each media source after its stream list arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.Id, subtitles]);

  useEffect(() => {
    if (!source || !subtitles.length || subtitleIndex === null || subtitleStream) return;
    void chooseSubtitle(playbackPrefs.current.subtitlesOff
      ? null
      : resolveWebSubtitleIndex(subtitles, null, playbackPrefs.current.subtitleLanguage));
  }, [subtitleIndex, subtitleStream, subtitles, source]);

  useEffect(() => {
    if (audioIndex !== null || !audioStreams.length || !playbackPrefs.current.audioLanguage) return;
    const preferred = audioStreams.find((stream) => stream.Language === playbackPrefs.current.audioLanguage);
    if (preferred && preferred.Index !== audioStream?.Index) changeAudioTrack(preferred.Index, false);
    // Restore a preferred language only after Jellyfin returns the track list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioStreams, source?.Id]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) { video.defaultPlaybackRate = playbackRate; video.playbackRate = playbackRate; }
    playbackPrefs.current = { ...playbackPrefs.current, rate: playbackRate, fit: videoFit };
    mediaStorage.setItem(playbackPrefsKey, JSON.stringify(playbackPrefs.current));
  }, [playbackRate, videoFit]);

  useEffect(() => {
    if (ended) {
      setPauseCinema(false);
      setPauseTitleHandoff(false);
      return;
    }
    if (playing) {
      setPauseCinema(false);
      setPauseTitleHandoff(false);
      showTitle(true);
      return;
    }
    // `playing` is false while PlaybackInfo, HLS, or the first transcode
    // segment is still loading. That is startup, not a user pause.
    if (!hasPlaybackStarted || switchingPlayback) {
      setPauseCinema(false);
      setPauseTitleHandoff(false);
      return;
    }
    // Paused: pause cinema owns the handoff below, so no independent hide.
    showTitle(false);
    let handoffTimer: number | null = null;
    const timer = window.setTimeout(() => {
      setPauseCinema(true);
      setPauseTitleHandoff(true);
      setControls(false);
      handoffTimer = window.setTimeout(() => {
        setPauseTitleHandoff(false);
        setTitleLingering(false);
      }, pauseTitleHandoffMs);
    }, 10_000);
    return () => {
      window.clearTimeout(timer);
      if (handoffTimer !== null) window.clearTimeout(handoffTimer);
    };
  }, [ended, hasPlaybackStarted, playing, showTitle, switchingPlayback]);

  const clearSubtitleCue = useCallback(() => {
    cueRef.current = "";
    setCue("");
  }, []);

  const invalidateSubtitleClock = useCallback(() => {
    subtitleClockEpochRef.current += 1;
    clearSubtitleCue();
  }, [clearSubtitleCue]);

  const syncSubtitleCue = useCallback((mediaTime?: number, clockSource: "DOM currentTime" | "Decoded frame timestamp" = "DOM currentTime", clockEpoch = subtitleClockEpochRef.current) => {
    // A callback queued before a seek may arrive after the new position has
    // settled. Epoch ownership keeps that old decoded frame from repainting a
    // pre-seek cue; active scrubs remain deliberately blank.
    if (clockEpoch !== subtitleClockEpochRef.current || mediaSeekingRef.current || seekingRef.current) return;
    const seconds = mediaTime ?? videoRef.current?.currentTime ?? positionRef.current;
    subtitleClockRef.current = { seconds, source: clockSource };
    // Subtract the delay to look the cue up EARLIER in the file, which puts it
    // on screen later. One read point for every path — the frame loop, the
    // seek/timeupdate resync, and the track-load repaint all land here.
    const nextCue = mediaCueTextAt(subtitleCuesRef.current, seconds - subtitleDelayRef.current);
    if (nextCue === cueRef.current) return;
    cueRef.current = nextCue;
    setCue(nextCue);
  }, []);

  const syncSubtitleAtOwnedClock = useCallback(() => {
    const video = videoRef.current;
    if (playing && typeof video?.requestVideoFrameCallback === "function") {
      const sample = subtitleClockRef.current;
      syncSubtitleCue(sample.seconds, sample.source);
      return;
    }
    syncSubtitleCue(video?.currentTime);
  }, [playing, syncSubtitleCue]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const snapshot = (event: Event) => recordPlaybackDiagnostic(event.type, {
      itemId: item.Id, title: item.Name, sourceId: source?.Id,
      currentTime: video.currentTime, clockSeconds: subtitleClockRef.current.seconds,
      clockSource: subtitleClockRef.current.source, clockMode: decodedFrameClockRef.current,
      epoch: subtitleClockEpochRef.current, seeking: video.seeking, scrubbing: seekingRef.current,
      paused: video.paused, readyState: video.readyState, networkState: video.networkState,
      playbackRate: video.playbackRate, delaySeconds: subtitleDelayRef.current,
      bufferedEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0,
      errorCode: video.error?.code ?? null,
    });
    const events = ["loadedmetadata", "seeking", "seeked", "playing", "pause", "waiting", "stalled", "error", "ratechange", "ended"];
    events.forEach((event) => video.addEventListener(event, snapshot));
    return () => { events.forEach((event) => video.removeEventListener(event, snapshot)); };
  }, [item.Id, item.Name, source?.Id]);

  const cleanupSubtitleTrack = useCallback(() => {
    subtitleLoadIdRef.current += 1;
    subtitleCuesRef.current = [];
    clearSubtitleCue();
  }, [clearSubtitleCue]);

  useEffect(() => cleanupSubtitleTrack, [cleanupSubtitleTrack]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const disableUnmanagedTracks = () => {
      for (let index = 0; index < video.textTracks.length; index += 1) {
        video.textTracks[index].mode = "disabled";
      }
      [...video.querySelectorAll("track")].forEach((track) => track.remove());
    };
    video.textTracks.addEventListener("addtrack", disableUnmanagedTracks);
    disableUnmanagedTracks();
    return () => video.textTracks.removeEventListener("addtrack", disableUnmanagedTracks);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (let index = 0; index < video.textTracks.length; index += 1) {
      video.textTracks[index].mode = "disabled";
    }
    if (pauseCinema) {
      clearSubtitleCue();
      return;
    }
    // While video is advancing, decoded-frame callbacks own the caption clock.
    // DOM currentTime remains the paused/fallback clock only.
    if (subtitleStream && (!playing || typeof video.requestVideoFrameCallback !== "function")) syncSubtitleCue();
  }, [clearSubtitleCue, pauseCinema, playing, subtitleStream, syncSubtitleCue]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !subtitleStream || pauseCinema || !playing) return;
    let stopped = false;
    let videoFrame: number | null = null;
    let animationFrame: number | null = null;

    const syncAnimationFrame = () => {
      if (stopped) return;
      syncSubtitleCue(video.currentTime);
      animationFrame = window.requestAnimationFrame(syncAnimationFrame);
    };
    const scheduleVideoFrame = () => {
      const clockEpoch = subtitleClockEpochRef.current;
      videoFrame = video.requestVideoFrameCallback((_now, metadata) => {
        if (stopped) return;
        const ownsTimeline = clockEpoch === subtitleClockEpochRef.current && !mediaSeekingRef.current && !seekingRef.current;
        if (ownsTimeline) {
          if (decodedFrameClockRef.current === "detect" && Number.isFinite(video.currentTime) && Number.isFinite(metadata.mediaTime)) {
            decodedFrameClockRef.current = Math.abs(video.currentTime - metadata.mediaTime) <= .5 ? "decoded" : "dom";
          }
          const frameTime = subtitleFrameTime(video.currentTime, metadata.mediaTime, decodedFrameClockRef.current);
          recordPlaybackFrame({ itemId: item.Id, currentTime: video.currentTime, mediaTime: metadata.mediaTime,
            presentedFrames: metadata.presentedFrames, clockMode: decodedFrameClockRef.current,
            epoch: clockEpoch, ownsTimeline, delaySeconds: subtitleDelayRef.current });
          const usesDecodedFrameTime = decodedFrameClockRef.current === "decoded" && Number.isFinite(metadata.mediaTime);
          syncSubtitleCue(frameTime, usesDecodedFrameTime ? "Decoded frame timestamp" : "DOM currentTime", clockEpoch);
        }
        if (!ownsTimeline) recordPlaybackFrame({ itemId: item.Id, currentTime: video.currentTime,
          mediaTime: metadata.mediaTime, epoch: clockEpoch, ownsTimeline, seeking: video.seeking,
          scrubbing: seekingRef.current, clockMode: decodedFrameClockRef.current });
        scheduleVideoFrame();
      });
    };

    if (typeof video.requestVideoFrameCallback === "function") {
      scheduleVideoFrame();
    } else {
      syncSubtitleCue(video.currentTime);
      animationFrame = window.requestAnimationFrame(syncAnimationFrame);
    }
    return () => {
      stopped = true;
      if (videoFrame !== null && typeof video.cancelVideoFrameCallback === "function") video.cancelVideoFrameCallback(videoFrame);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [pauseCinema, playing, subtitleStream, syncSubtitleCue]);

  // Decoded frames are the sole clock while playing. DOM media events only
  // paint while paused or on browsers without requestVideoFrameCallback.
  // Every seek invalidates callbacks queued against the previous timeline.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const usesDecodedFrameClock = playing && typeof video.requestVideoFrameCallback === "function";
    const timeupdate = () => {
      if (!pauseCinema && !usesDecodedFrameClock) syncSubtitleCue(video.currentTime);
    };
    const seeking = () => {
      mediaSeekingRef.current = true;
      invalidateSubtitleClock();
    };
    const seeked = () => {
      mediaSeekingRef.current = false;
      subtitleClockEpochRef.current += 1;
      if (!pauseCinema && !seekingRef.current && !usesDecodedFrameClock) syncSubtitleCue(video.currentTime);
    };
    video.addEventListener("timeupdate", timeupdate);
    video.addEventListener("seeked", seeked);
    video.addEventListener("seeking", seeking);
    return () => {
      video.removeEventListener("timeupdate", timeupdate);
      video.removeEventListener("seeked", seeked);
      video.removeEventListener("seeking", seeking);
    };
  }, [invalidateSubtitleClock, pauseCinema, playing, syncSubtitleCue]);

  useEffect(() => {
    const invalidateSubtitleLayer = () => {
      if (document.hidden) return;
      syncSubtitleAtOwnedClock();
      setSubtitleRenderEpoch((epoch) => epoch + 1);
    };
    window.addEventListener("pageshow", invalidateSubtitleLayer);
    document.addEventListener("visibilitychange", invalidateSubtitleLayer);
    document.addEventListener("fullscreenchange", invalidateSubtitleLayer);
    document.addEventListener("webkitfullscreenchange", invalidateSubtitleLayer);
    return () => {
      window.removeEventListener("pageshow", invalidateSubtitleLayer);
      document.removeEventListener("visibilitychange", invalidateSubtitleLayer);
      document.removeEventListener("fullscreenchange", invalidateSubtitleLayer);
      document.removeEventListener("webkitfullscreenchange", invalidateSubtitleLayer);
    };
  }, [syncSubtitleAtOwnedClock]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const begin = () => { fullscreenIntentRef.current = true; syncSubtitleAtOwnedClock(); };
    const end = () => { fullscreenIntentRef.current = false; syncSubtitleAtOwnedClock(); };
    const standardChange = () => {
      const fullscreenDocument = document as SafariFullscreenDocument;
      const active = Boolean(document.fullscreenElement || fullscreenDocument.webkitFullscreenElement);
      fullscreenIntentRef.current = active;
      if (!active) setViewportFullscreen(false);
      syncSubtitleAtOwnedClock();
    };
    const presentationChange = () => {
      fullscreenIntentRef.current = video.webkitPresentationMode === "fullscreen";
      syncSubtitleAtOwnedClock();
    };
    video.addEventListener("webkitbeginfullscreen", begin);
    video.addEventListener("webkitendfullscreen", end);
    video.addEventListener("webkitpresentationmodechanged", presentationChange);
    document.addEventListener("fullscreenchange", standardChange);
    document.addEventListener("webkitfullscreenchange", standardChange);
    return () => {
      video.removeEventListener("webkitbeginfullscreen", begin);
      video.removeEventListener("webkitendfullscreen", end);
      video.removeEventListener("webkitpresentationmodechanged", presentationChange);
      document.removeEventListener("fullscreenchange", standardChange);
      document.removeEventListener("webkitfullscreenchange", standardChange);
    };
  }, [syncSubtitleAtOwnedClock]);

  function copyStatsDiagnostics() {
    const diagnostics = formatSanitizedPlaybackDiagnostics(playbackStats);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(diagnostics).then(
        () => setNotice("Playback stats copied."),
        () => setNotice("Could not copy playback stats."),
      );
    } else setNotice("Clipboard access is unavailable in this browser.");
  }

  function preparePlaybackSwitch() {
    const video = videoRef.current;
    if (video && Number.isFinite(video.currentTime)) positionRef.current = video.currentTime;
    setSwitchingPlayback(true);
    setStartupStage("preparing");
    setStartupProgress(8);
    setPauseCinema(false);
    setPauseTitleHandoff(false);
  }

  function retryPlayback() {
    preparePlaybackSwitch();
    dismissError();
    recordTrace("retry");
    setPlaybackAttempt((attempt) => attempt + 1);
  }

  function copyDiagnostics() {
    copyStatsDiagnostics();
  }

  function changeQuality(quality: PlaybackQuality) {
    if (quality === qualityPreference) return;
    preparePlaybackSwitch();
    playbackPrefs.current = { ...playbackPrefs.current, quality };
    mediaStorage.setItem(playbackPrefsKey, JSON.stringify(playbackPrefs.current));
    setQualityPreference(quality);
  }

  function changeAudioTrack(index: number, announce = true) {
    const selected = audioStreams.find((stream) => stream.Index === index);
    if (!selected || selected.Index === audioStream?.Index) return;
    preparePlaybackSwitch();
    playbackPrefs.current = { ...playbackPrefs.current, audioLanguage: selected.Language };
    mediaStorage.setItem(playbackPrefsKey, JSON.stringify(playbackPrefs.current));
    setAudioIndex(selected.Index);
    if (announce) setNotice(`Switching to ${audioTrackLabel(selected)}…`);
  }

  function chooseSubtitle(index: number | null) {
    timingController.current?.dispose();
    timingController.current = null;
    subtitleDelayRef.current = 0;
    setSubtitleTiming({ ...emptyTiming });
    setSubtitleIndex(index);
    const selected = subtitles.find((entry) => entry.Index === index);
    playbackPrefs.current = {
      ...playbackPrefs.current,
      subtitleLanguage: selected?.Language,
      subtitlesOff: index === null,
    };
    mediaStorage.setItem(playbackPrefsKey, JSON.stringify(playbackPrefs.current));
    setCue("");
    const video = videoRef.current;
    if (!video || !source) return;
    cleanupSubtitleTrack();
    [...video.querySelectorAll("track")].forEach((node) => {
      node.track.mode = "disabled";
      node.remove();
    });
    if (index === null) { dismissError(); return; }
    if (!selected) { showError("Could not load subtitle track.", "warning"); return; }
    dismissError();
    const loadId = subtitleLoadIdRef.current;
    void fetch(subtitleTrackUrl(item.Id, source.Id, index), { cache: "no-cache", credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(`Subtitle request failed (${response.status})`);
        return response.text().then((body) => ({
          body,
          track: response.headers?.get("X-Cloud-Media-Subtitle-Key"),
          contentKey: response.headers?.get("X-Cloud-Media-Subtitle-Content-Key"),
          timingKey: response.headers?.get("X-Cloud-Media-Subtitle-Timing-Key"),
        }));
      })
      .then(({ body, track, contentKey, timingKey }) => {
        if (subtitleLoadIdRef.current !== loadId) return;
        subtitleCuesRef.current = parseMediaVtt(body);
        const activeVideo = videoRef.current;
        if (track && /^[a-f0-9]{64}$/.test(track)) {
          // Timing geometry survives a text-only replacement/translation.
          // Older gateways only send contentKey, which remains the fallback.
          const defaultKey = timingKey && /^[a-f0-9]{64}$/.test(timingKey) ? timingKey
            : contentKey && /^[a-f0-9]{64}$/.test(contentKey) ? contentKey : null;
          const fallbackContentKey = timingKey && /^[a-f0-9]{64}$/.test(timingKey)
            && contentKey && /^[a-f0-9]{64}$/.test(contentKey) ? contentKey : null;
          const draftKey = `${item.Id}:${defaultKey ?? track}`;
          const controller = new SubtitleTimingController(item.Id, track, defaultKey, (timing) => {
            if (subtitleLoadIdRef.current !== loadId) return;
            // refresh() emits a not-ready state before its request finishes.
            // Do not let that transient state erase the cache that hydrated
            // this controller; its delay is still applied immediately below.
            if (timing.ready) {
              if (timing.sessionDraft) subtitleTimingDrafts.current.set(draftKey, timing.sessionDraft);
              else subtitleTimingDrafts.current.delete(draftKey);
            }
            subtitleDelayRef.current = timing.delay;
            setSubtitleTiming(timing);
            syncSubtitleAtOwnedClock();
          }, subtitleTimingDrafts.current.get(draftKey), fallbackContentKey);
          timingController.current = controller;
          void controller.refresh();
        } else setSubtitleTiming({ ...emptyTiming, error: "Saved timing is unavailable. Reload after the gateway update." });
        if (!playing || typeof activeVideo?.requestVideoFrameCallback !== "function") syncSubtitleCue();
        dismissError();
      })
      .catch(() => {
        if (subtitleLoadIdRef.current === loadId) showError("Could not load subtitle track.", "warning");
      });
  }

  function updateSeekPreview(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointer = event.clientX - bounds.left;
    const fraction = Math.min(1, Math.max(0, pointer / bounds.width));
    const halfPreview = Math.min(110, bounds.width / 2);
    const left = Math.max(halfPreview, Math.min(bounds.width - halfPreview, pointer));
    setSeekPreview({ time: fraction * (duration || 0), left });
  }

  // Apply the newest dragged position to the video, at most once per frame.
  function flushScrub() {
    scrubRafRef.current = null;
    const video = videoRef.current;
    const target = scrubPendingRef.current;
    if (video && target !== null && Math.abs(video.currentTime - target) > .05) {
      video.currentTime = target;
    }
  }

  function scheduleScrub(target: number) {
    scrubPendingRef.current = target;
    if (scrubRafRef.current === null) scrubRafRef.current = window.requestAnimationFrame(flushScrub);
  }

  function commitSeek(target = seekTargetRef.current) {
    if (scrubRafRef.current !== null) { window.cancelAnimationFrame(scrubRafRef.current); scrubRafRef.current = null; }
    scrubPendingRef.current = null;
    const video = videoRef.current;
    if (video && target !== null) {
      // Pointer-up can be followed by one final native range change event.
      // Avoid turning that duplicate value into a second HLS request.
      if (Math.abs(video.currentTime - target) > .05) {
        invalidateSubtitleClock();
        video.currentTime = target;
      }
      positionRef.current = target;
      setPosition(target);
    }
    seekTargetRef.current = null;
    setSeekTarget(null);
  }

  function seekBy(delta: number, video = videoRef.current) {
    if (!video) return;
    const target = seekTime(video.currentTime, delta, video.duration);
    if (Math.abs(video.currentTime - target) <= .05) return;
    invalidateSubtitleClock();
    video.currentTime = target;
    positionRef.current = target;
    setPosition(target);
    seekTargetRef.current = null;
    setSeekTarget(null);
  }

  function replaySubtitleCue(cue: MediaSubtitleCue) {
    const video = videoRef.current;
    if (!video) return;
    // The delay moves a VTT cue on the media timeline, so replay its displayed
    // start rather than the unadjusted source timestamp.
    const upperBound = Number.isFinite(video.duration) ? Math.max(0, video.duration - .01) : Number.POSITIVE_INFINITY;
    commitSeek(Math.min(upperBound, Math.max(0, cue.start + subtitleDelayRef.current)));
    if (!playing || typeof video.requestVideoFrameCallback !== "function") syncSubtitleCue(video.currentTime);
  }

  function changeSeekTarget(target: number) {
    seekTargetRef.current = target;
    setSeekTarget(target);
    // During a pointer drag, scrub the video live (rAF-throttled) so the frame
    // tracks the thumb. Keyboard/track-click changes commit immediately.
    if (seekingRef.current) scheduleScrub(target);
    else commitSeek(target);
  }

  function beginUserSeek() {
    seekingRef.current = true;
    invalidateSubtitleClock();
    setSeeking(true);
  }

  function finishUserSeek() {
    seekingRef.current = false;
    subtitleClockEpochRef.current += 1;
    setSeeking(false);
    const video = videoRef.current;
    if (!video || mediaSeekingRef.current || pauseCinema) return;
    if (!playing || typeof video.requestVideoFrameCallback !== "function") syncSubtitleCue(video.currentTime);
  }

  function showAirPlayPicker() {
    const video = videoRef.current;
    if (!video) return;
    setNotice("");
    if (typeof video.webkitShowPlaybackTargetPicker === "function") {
      const airPlayUrl = airPlayUrlRef.current;
      if (!airPlayUrl) {
        setNotice("AirPlay is still preparing this movie. Try again in a moment.");
        return;
      }
      const currentUrl = video.currentSrc || video.src;
      if (currentUrl !== airPlayUrl) {
        const resumeAt = video.currentTime;
        const shouldResume = !video.paused;
        const rate = video.playbackRate;
        hlsRef.current?.destroy();
        hlsRef.current = null;
        const restorePlayback = () => {
          video.currentTime = Math.min(resumeAt, Number.isFinite(video.duration) ? Math.max(0, video.duration - .1) : resumeAt);
          video.playbackRate = rate;
          if (shouldResume) void startVideoPlayback(video).catch(() => setNotice("AirPlay connected, but playback could not resume."));
        };
        video.addEventListener("loadedmetadata", restorePlayback, { once: true });
        video.src = airPlayUrl;
        video.load();
      }
      try { video.webkitShowPlaybackTargetPicker(); }
      catch { setNotice("Could not open AirPlay. Check that AirPlay is enabled on this Mac."); }
      return;
    }
    setNotice(airPlayUnavailableMessage(navigator.userAgent));
  }

  function ensureVolumeGain(): GainNode | null {
    if (audioGainRef.current) {
      if (audioContextRef.current?.state === "suspended") void audioContextRef.current.resume();
      return audioGainRef.current;
    }
    const video = videoRef.current;
    const AudioContextConstructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!video || !AudioContextConstructor) return null;
    try {
      const context = new AudioContextConstructor();
      const source = context.createMediaElementSource(video);
      const gain = context.createGain();
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -6;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = .003;
      compressor.release.value = .25;
      source.connect(gain).connect(compressor).connect(context.destination);
      audioContextRef.current = context;
      audioSourceRef.current = source;
      audioGainRef.current = gain;
      if (context.state === "suspended") void context.resume();
      return gain;
    } catch {
      return null;
    }
  }

  function changeVolume(nextVolume: number) {
    const video = videoRef.current;
    if (!video) return;
    let next = Math.min(2, Math.max(0, nextVolume));
    const gain = next > 1 ? ensureVolumeGain() : audioGainRef.current;
    if (next > 1 && !gain) {
      next = 1;
      setNotice("Volume boost is unavailable in this browser.");
    }
    if (gain && audioContextRef.current) gain.gain.setTargetAtTime(Math.max(1, next), audioContextRef.current.currentTime, .015);
    video.volume = Math.min(1, next);
    video.muted = next === 0;
    volumeRef.current = next;
    setVolume(next);
    playbackPrefs.current = { ...playbackPrefs.current, muted: next === 0, volume: next };
    mediaStorage.setItem(playbackPrefsKey, JSON.stringify(playbackPrefs.current));
  }

  function restorePlaybackAudio(video: HTMLVideoElement) {
    const prefs = playbackPrefs.current;
    video.volume = Math.min(1, Math.max(0, prefs.volume));
    video.muted = prefs.muted || prefs.volume <= 0;
    if (audioContextRef.current?.state === "suspended") void audioContextRef.current.resume().catch(() => undefined);
  }

  function startVideoPlayback(video = videoRef.current): Promise<void> {
    if (!video) return Promise.resolve();
    // Source attachment, resume seeks, backgrounding, and Safari can each
    // suspend a previously valid output path. Every play intent restores it.
    restorePlaybackAudio(video);
    return video.play();
  }

  function pauseVideoPlayback(video = videoRef.current) {
    if (!video) return;
    // A pause during source setup normally means WebKit interrupted startup,
    // but keyboard/click pauses are explicit user intent and must never be
    // "recovered" into playback by the startup retry loop.
    initialPlayPendingRef.current = false;
    video.pause();
  }

  function toggleFullscreen() {
    const fullscreenDocument = document as SafariFullscreenDocument;
    if (document.fullscreenElement || fullscreenDocument.webkitFullscreenElement) {
      fullscreenIntentRef.current = false;
      setViewportFullscreen(false);
      const exit = document.exitFullscreen?.bind(document) ?? fullscreenDocument.webkitExitFullscreen?.bind(fullscreenDocument);
      const result = exit?.();
      if (result instanceof Promise) void result.catch(() => undefined);
      return;
    }
    if (viewportFullscreen) { fullscreenIntentRef.current = false; setViewportFullscreen(false); return; }
    const shell = shellRef.current;
    const standardRequest = shell?.requestFullscreen?.bind(shell);
    const legacyRequest = shell?.webkitRequestFullscreen?.bind(shell);
    const forbidLegacyFullscreen = prefersViewportFullscreen(
      navigator.maxTouchPoints,
      window.matchMedia("(pointer: coarse)").matches,
      navigator.userAgent,
    );
    const strategy = fullscreenStrategy(Boolean(standardRequest), Boolean(legacyRequest), forbidLegacyFullscreen);
    const request = strategy === "standard-shell" ? standardRequest : strategy === "legacy-shell" ? legacyRequest : undefined;
    fullscreenIntentRef.current = true;
    const useViewport = () => {
      if (!fullscreenIntentRef.current) return;
      setViewportFullscreen(true);
      window.scrollTo(0, 0);
    };
    if (strategy === "viewport") {
      useViewport();
      return;
    }
    if (strategy === "standard-shell" || strategy === "legacy-shell") {
      try {
        const result = request?.();
        if (result instanceof Promise) void result.catch(useViewport);
        window.setTimeout(() => {
          const fullscreenDocument = document as SafariFullscreenDocument;
          if (!document.fullscreenElement && !fullscreenDocument.webkitFullscreenElement && fullscreenIntentRef.current) useViewport();
        }, 600);
      } catch {
        useViewport();
      }
      return;
    }
  }
  toggleFullscreenRef.current = toggleFullscreen;

  const touch = usePlayerTouch(() => {
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
    setControls(!controls);
    if (!controls && playing) controlsTimerRef.current = window.setTimeout(() => setControls(false), 2800);
  }, (delta) => seekBy(delta), Boolean(settings) || ended);

  function handlePlayerMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (touch.suppressMouse()) return;
    if (ended) { autoCancelled.current = true; if (endCountdown !== null) setEndCountdown(null); return; }
    setControls(true);
    if (transportTimerRef.current !== null) window.clearTimeout(transportTimerRef.current);
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
    if (shouldArmTitleTimer(titleTimerRef.current !== null) && !videoRef.current?.paused) showTitle(true);
    const target = event.target as Element;
    const overControl = Boolean(target.closest(".player-controls button, .seek-wrap, .player-settings, .player-stats-overlay"));
    const bounds = event.currentTarget.getBoundingClientRect();
    const inTransportArea = Math.abs(event.clientX - (bounds.left + bounds.width / 2)) <= Math.min(245, bounds.width * .27)
      && Math.abs(event.clientY - (bounds.top + bounds.height / 2)) <= Math.min(105, bounds.height * .18);
    const nearControlZone = inTransportArea
      || event.clientY <= bounds.top + Math.min(120, bounds.height * .18)
      || event.clientY >= bounds.bottom - Math.min(180, bounds.height * .28);
    if (overControl || inTransportArea) setTransportHover(true);
    else setTransportHover(false);
    if (!overControl) {
      const controlsDelay = nearControlZone ? 10_000 : 2_800;
      transportTimerRef.current = window.setTimeout(() => setTransportHover(false), inTransportArea ? 10_000 : 900);
      controlsTimerRef.current = window.setTimeout(() => setControls(false), controlsDelay);
    }
  }

  function closePlayer() {
    if (stoppedRef.current) { onClose(); return; }
    stoppedRef.current = true;
    void enqueueReport("stop").finally(onClose);
  }

  function playEpisode(episode: MediaItem) {
    if (!onPlayEpisode || episode.Id === item.Id) { setSettings(null); return; }
    if (stoppedRef.current) { onPlayEpisode(episode); return; }
    stoppedRef.current = true;
    void enqueueReport("stop").finally(() => onPlayEpisode(episode));
  }

  function finishPlayback() {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    initialPlayPendingRef.current = false;
    setEnded(true);
    setPlaying(false);
    setPauseCinema(false);
    setPauseTitleHandoff(false);
    setTitleLingering(false);
    setControls(false);
    setSettings(null);
    setRatingCard(null);
    cleanupSubtitleTrack();
    void enqueueReport("stop");
  }

  function replayFromEnd() {
    setEndCountdown(null);
    if (onReplay) { onReplay(); return; }
    const video = videoRef.current;
    if (!video) return;
    stoppedRef.current = false;
    setEnded(false);
    video.currentTime = 0;
    void startVideoPlayback(video);
  }

  const subtitleTimingControls = subtitleTiming.canAdjustTiming && <details open={timingExpanded ?? (phonePortrait || smartphoneLandscape)} className="settings-group subtitle-timing-group" aria-labelledby="subtitle-timing-heading">
            <summary className="subtitle-timing-heading" onClick={(event) => { event.preventDefault(); setTimingExpanded(!(timingExpanded ?? (phonePortrait || smartphoneLandscape))); }}>
              <h3 id="subtitle-timing-heading">Subtitle timing</h3>
              <output className="subtitle-timing-value" data-adjusted={Boolean(subtitleStream && subtitleTiming.delay)} aria-live="polite" aria-label={!subtitleStream ? "Subtitles off" : timingLabel(subtitleTiming.delay)}>
                <span>{!subtitleStream ? "Off" : !subtitleTiming.delay ? "Original" : subtitleTiming.delay < 0 ? "Earlier" : "Later"}</span>
                {!!subtitleStream && !!subtitleTiming.delay && <strong>{Math.abs(subtitleTiming.delay)} <small>s</small></strong>}
              </output>
              <ChevronDown className="timing-disclosure-icon" aria-hidden="true" />
            </summary>
            <div className="subtitle-timing-body">
            <div className="subtitle-timing-actions" role="group" aria-label="Subtitle timing">
              <button type="button" className="timing-nudge timing-nudge-fine" disabled={!subtitleStream || !subtitleTiming.ready} onClick={() => timingController.current?.adjust(-subtitleDelayStepSeconds)}><span className="timing-button-label"><ArrowLeft aria-hidden="true" />Earlier</span><small>Fine · 0.1 s</small></button>
              <button type="button" className="timing-nudge" disabled={!subtitleStream || !subtitleTiming.ready} onClick={() => timingController.current?.adjust(-.5)}><span className="timing-button-label"><ArrowLeft aria-hidden="true" />Earlier</span><small>Coarse · 0.5 s</small></button>
              <button type="button" className="timing-reset" disabled={!subtitleStream || !subtitleTiming.ready} onClick={() => timingController.current?.adjust(null)}><span className="timing-button-label"><RotateCcw aria-hidden="true" />Reset</span></button>
              <button type="button" className="timing-nudge" disabled={!subtitleStream || !subtitleTiming.ready} onClick={() => timingController.current?.adjust(.5)}><span className="timing-button-label">Later<ArrowRight aria-hidden="true" /></span><small>Coarse · 0.5 s</small></button>
              <button type="button" className="timing-nudge timing-nudge-fine" disabled={!subtitleStream || !subtitleTiming.ready} onClick={() => timingController.current?.adjust(subtitleDelayStepSeconds)}><span className="timing-button-label">Later<ArrowRight aria-hidden="true" /></span><small>Fine · 0.1 s</small></button>
            </div>
            <section className="subtitle-sync-preview" aria-label="Live subtitle sync preview">
              <header><span>Sync preview</span><time>{subtitlePreviewTime(subtitleClockRef.current.seconds)}</time></header>
              {subtitleSyncPreview.length > 0 ? <div>{subtitleSyncPreview.map(({ entry, active, relation }) => <article key={`${entry.start}:${entry.end}:${entry.text}`} className={active ? "active" : ""}>
                <div><small>{relation}</small><time>{subtitlePreviewTime(entry.start + subtitleTiming.delay)}–{subtitlePreviewTime(entry.end + subtitleTiming.delay)}</time></div>
                <p>{entry.text}</p>
                <button type="button" onClick={() => replaySubtitleCue(entry)}>Jump to cue</button>
              </article>)}</div> : <p>No subtitle cues loaded yet.</p>}
            </section>
            <p className={subtitleTiming.error ? "subtitle-timing-error" : "subtitle-timing-note"} role={subtitleTiming.error ? "alert" : undefined}>{subtitleTiming.error || (subtitleTiming.saving ? "Saving default for everyone…" : subtitleTiming.ready ? subtitleTiming.baselineRevision ? "This title default is used for everyone. Nudges stay in this player until saved." : subtitleTiming.canSaveAsDefault ? "This is a temporary draft. Save it to make it the default for everyone." : "Timing changes stay in this player." : subtitleStream ? "Loading…" : "Select a subtitle track to adjust timing.")}</p>
            {subtitleTiming.canSaveAsDefault && <Button variant="secondary" disabled={!subtitleStream || !subtitleTiming.ready || subtitleTiming.saving} onClick={() => void timingController.current?.saveAsDefault()}>Save timing</Button>}
            {subtitleTiming.error && timingController.current && <button type="button" onClick={() => subtitleTiming.ready ? void timingController.current?.saveAsDefault() : void timingController.current?.refresh()}>Retry</button>}
            </div>
          </details>;

  return (
    <motion.div ref={shellRef} role="dialog" aria-modal={settings ? undefined : true} aria-label={`Playing ${item.SeriesName ?? item.Name}`} className={`player-shell ${controls ? "" : "player-controls-hidden"} ${pauseCinema ? "player-pause-cinema" : ""} ${ended ? "player-ended" : ""} ${viewportFullscreen ? "player-viewport-fullscreen" : ""} ${isAppleTouchDevice() ? "player-apple-touch" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDownCapture={touch.onPointerDown} onPointerUpCapture={touch.onPointerUp} onPointerCancel={touch.onPointerCancel} onClickCapture={touch.onClickCapture} onMouseMove={handlePlayerMouseMove} onMouseLeave={() => {
      setTransportHover(false);
      setControls(false);
    }}>
      {touch.feedback !== null && <div role="status" className={`player-touch-feedback ${touch.feedback < 0 ? "backward" : "forward"}`}><span aria-hidden="true">{touch.feedback < 0 ? "«" : "»"}</span>{touch.feedback < 0 ? "Back" : "Forward"} 10 seconds</div>}
      <video
        ref={videoRef}
        className="player-video"
        style={{ objectFit: videoFit, WebkitUserSelect: "none", userSelect: "none" }}
        playsInline
        autoPlay
        x-webkit-airplay="allow"
        onPlay={(event) => restorePlaybackAudio(event.currentTarget)}
        onLoadedMetadata={(event) => { recordTrace("metadata"); const percent = mediaReadyStartupPercent(event.currentTarget.readyState); setStartupProgress((value) => Math.max(value, percent)); }}
        onLoadedData={(event) => { const percent = mediaReadyStartupPercent(event.currentTarget.readyState); setStartupProgress((value) => Math.max(value, percent)); }}
        onProgress={(event) => { const percent = startupStage === "buffering" ? bufferedStartupPercent(event.currentTarget) : mediaReadyStartupPercent(event.currentTarget.readyState); setStartupProgress((value) => startupStage === "buffering" ? percent : Math.max(value, percent)); }}
        onPlaying={() => { recordTrace(hasPlaybackStartedRef.current ? "buffering-end" : "first-moving-frame"); initialPlayPendingRef.current = false; hasPlaybackStartedRef.current = true; setHasPlaybackStarted(true); setEnded(false); setPlaying(true); setSwitchingPlayback(false); setStartupProgress(100); setStartupStage(null); setPauseCinema(false); setPauseTitleHandoff(false); showTitle(true); }}
        onLoadStart={() => { setStartupStage("starting"); setStartupProgress((value) => Math.max(value, 68)); }}
        onWaiting={(event) => { recordTrace("buffering-start"); setStartupStage("buffering"); setStartupProgress(bufferedStartupPercent(event.currentTarget)); }}
        onCanPlay={(event) => { const percent = mediaReadyStartupPercent(event.currentTarget.readyState); setStartupProgress((value) => Math.max(value, percent)); if (!playing) setStartupStage("starting"); }}
        onPause={(event) => { setPlaying(false); if (hasPlaybackStartedRef.current) setPauseFrame(captureVideoFrame(event.currentTarget)); report(true); }}
        onTimeUpdate={(event) => { positionRef.current = event.currentTarget.currentTime; setPosition(event.currentTarget.currentTime); report(); }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted);
          const effectiveVolume = volumeRef.current > 1 && event.currentTarget.volume === 1 ? volumeRef.current : event.currentTarget.volume;
          volumeRef.current = effectiveVolume;
          setVolume(effectiveVolume);
          playbackPrefs.current = { ...playbackPrefs.current, muted: event.currentTarget.muted, volume: effectiveVolume };
          mediaStorage.setItem(playbackPrefsKey, JSON.stringify(playbackPrefs.current));
        }}
        onSeeked={() => { positionRef.current = videoRef.current?.currentTime ?? positionRef.current; if (hasPlaybackStartedRef.current && videoRef.current?.paused) setPauseFrame(captureVideoFrame(videoRef.current)); report(true); }}
        onEnded={finishPlayback}
        onClick={(event) => event.currentTarget.paused ? void startVideoPlayback(event.currentTarget) : pauseVideoPlayback(event.currentTarget)}
      />
      {!playing && !ended && pauseFrame && <img className="player-paused-frame" src={pauseFrame} alt="" aria-hidden="true" draggable={false} style={{ objectFit: videoFit, WebkitUserSelect: "none", userSelect: "none" }} />}
      {startupStage && !ended && (!hasPlaybackStarted || switchingPlayback || startupStage === "buffering") && (
        <div className="player-startup-stage" role="status" aria-live="polite" aria-label={startupStage === "preparing" ? "Preparing" : startupStage === "starting" ? "Starting stream" : "Buffering"}>
          <span aria-hidden="true"><strong>{startupProgress}%</strong></span>
        </div>
      )}
      <AnimatePresence>
        {!ended && titleOwners.pause && (
          <motion.div className="pause-cinema" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .65, ease: [0.22, 1, 0.36, 1] }}>
            <motion.div className="pause-cinema-art" style={{ backgroundImage: `url(${pauseFrame || imageUrl(item, item.BackdropImageTags?.length ? "Backdrop" : "Primary", 1800)})` }} initial={{ scale: 1.055 }} animate={{ scale: 1.02 }} transition={{ duration: 1.1, ease: "easeOut" }} />
            <div className="pause-cinema-shade" />
            <div className="pause-cinema-copy">
              <div className="pause-cinema-heading">
                <motion.h1 className={/^\d+$/.test(pauseTitle.trim()) ? "numeric-title" : undefined} initial={{ opacity: 0, x: reduceMotion ? 0 : -22 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: pauseDelays.title, duration: reduceMotion ? .22 : .58, ease: [0.22, 1, 0.36, 1] }}>{pauseTitleLead}<span className="pause-title-tail">{pauseTitleTail}{yearLabel && <motion.small initial={{ opacity: 0, x: reduceMotion ? 0 : -18, scale: reduceMotion ? 1 : .96 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ delay: pauseDelays.year, duration: reduceMotion ? .22 : .56, ease: [0.22, 1, 0.36, 1] }}>{yearLabel}</motion.small>}</span></motion.h1>
              </div>
              {item.SeriesName && <motion.h2 initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: pauseDelays.episode, duration: reduceMotion ? .22 : .56, ease: [0.22, 1, 0.36, 1] }}>{item.Name}</motion.h2>}
              {item.Overview && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: pauseDelays.synopsis, duration: reduceMotion ? .22 : pauseSynopsisDurationSeconds, ease: [0.22, 1, 0.36, 1] }}>{item.Overview}</motion.p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {cue && !pauseCinema && !ended && <div key={subtitleRenderEpoch} data-render-epoch={subtitleRenderEpoch} className="subtitle-layer" style={{ bottom: `${captionOffset}%`, fontSize: `clamp(${18 * captions.fontSize / 100}px, ${2.1 * captions.fontSize / 100}vw, ${48 * captions.fontSize / 100}px)`, fontWeight: captions.fontWeight, lineHeight: captions.lineHeight, letterSpacing: `${captions.letterSpacing}px` }}><span style={{ background: `rgba(0,0,0,${captions.backgroundOpacity})` }}>{cue}</span></div>}
      <div className="player-vignette" />
      <AnimatePresence>
        {statsOpen && !ended && (
          <motion.aside
            className="player-stats-overlay"
            aria-label="Stats for nerds"
            initial={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
            transition={{ duration: reduceMotion ? .1 : .18, ease: "easeOut" }}
          >
            <header>
              <strong>Stats for nerds</strong>
              <div>
                <button type="button" onClick={copyStatsDiagnostics}>Copy</button>
                <button type="button" aria-label="Close stats for nerds" onClick={() => setStatsOpen(false)}><X /></button>
              </div>
            </header>
            <PlaybackGraphs samples={statsSamples} native={!hls} />
            <div className="stats-panel">{playbackStats.map(([label, value]) => <div key={label} data-severity={classifyStat(label, value)}><span>{label}</span><strong title={value}>{value}</strong></div>)}</div>
          </motion.aside>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {!ended && titleOwners.corner && (
          <motion.div className="player-title-block" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .5, ease: [0.22, 1, 0.36, 1] }}>
            <div className="player-title-line"><strong>{item.SeriesName ?? item.Name}</strong>{yearLabel && <small>{yearLabel}</small>}</div>{item.SeriesName && <span>{item.Name}</span>}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {!ended && ratingCard !== null && ratingCards[ratingCard] && (
          <motion.div
            key={ratingCards[ratingCard]}
            className="player-rating-bug"
            initial={{ opacity: 0, x: reduceMotion ? 0 : 26, filter: reduceMotion ? "none" : "blur(7px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: reduceMotion ? 0 : 14, filter: reduceMotion ? "none" : "blur(5px)" }}
            transition={{ duration: reduceMotion ? .2 : .62, ease: [0.22, 1, 0.36, 1] }}
          >
            {(() => {
              const badge = ratingBadge(ratingCards[ratingCard]);
              const region = badge.scheme === "ca" ? "Canada (B.C.)"
                : badge.scheme === "ca-tv" ? "Canada"
                : badge.scheme === "us-film" || badge.scheme === "us-tv" ? "United States" : "";
              return (
                <>
                  <span className={`${ratingBadgeClassName(badge)} player-rating-badge`} aria-hidden="true"><RatingBadgeLabel scheme={badge.scheme} label={badge.label} /></span>
                  <span className="player-rating-copy" role="note" aria-label={`${badge.ariaLabel}. ${badge.name}. ${badge.description}`}>
                    {region && <span className="player-rating-region">{region}</span>}
                    <strong>{badge.name}</strong>
                    <span>{ratingDescriptionLines(badge.description).map((line, index) => <Fragment key={index}>{index > 0 && <br />}{line}</Fragment>)}</span>
                  </span>
                </>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {activeSegment && hasPlaybackStarted && !ended && !pauseCinema && (
          <motion.button
            className="player-skip-segment"
            type="button"
            onClick={() => changeSeekTarget(activeSegment.endSeconds)}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            transition={{ duration: reduceMotion ? .12 : .24, ease: "easeOut" }}
          >
            {skipSegmentLabel(activeSegment.type)} <span>›</span>
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {ended && (
          <motion.section
            className="player-end-screen"
            aria-label={`${item.SeriesName ? "Episode" : "Movie"} complete`}
            aria-live="polite"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? .18 : .48, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.div className="player-end-art" style={{ backgroundImage: `url(${imageUrl(item, item.BackdropImageTags?.length ? "Backdrop" : "Primary", 1800)})` }} initial={{ scale: reduceMotion ? 1.02 : 1.07 }} animate={{ scale: 1.02 }} transition={{ duration: reduceMotion ? .2 : 1.05, ease: "easeOut" }} />
            <div className="player-end-shade" />
            <motion.div className="player-end-copy" initial={{ opacity: 0, y: reduceMotion ? 0 : 22 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduceMotion ? 0 : .15, duration: reduceMotion ? .18 : .55, ease: [0.22, 1, 0.36, 1] }}>
              <span>{item.SeriesName ? "EPISODE COMPLETE" : "YOU WATCHED"}</span>
              <TitleIdentity item={item.SeriesName ? { ...item, Name: item.SeriesName, ImageTags: undefined } : item} variant="end" />
              {item.SeriesName && <p>{item.Name}</p>}
              {autoBlocked && <p>Autoplay paused. Choose Next to continue watching.</p>}
              <div className="player-end-actions">
                {(autoplayTarget ?? nextEpisode) && <Button onClick={() => playEpisode((autoplayTarget ?? nextEpisode)!)}>Next: {(autoplayTarget ?? nextEpisode)!.Name}{endCountdown !== null ? ` · ${endCountdown}` : ""}</Button>}
                <Button variant="secondary" onClick={replayFromEnd}>Replay</Button>
                {onSurprise && <Button variant="secondary" onClick={onSurprise}><Shuffle size={18} />Surprise me</Button>}
                <Button variant="ghost" onClick={closePlayer}>Back to {item.SeriesName ? "series" : "details"}</Button>
                {autoplayTarget && endCountdown !== null && <button className="player-end-cancel" onClick={() => { autoCancelled.current = true; setEndCountdown(null); }}>Cancel autoplay</button>}
              </div>
            </motion.div>
          </motion.section>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {controls && !ended && (
          <motion.div className="player-controls" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="player-top"><button className="player-icon" aria-label="Close player" onClick={closePlayer}><X /></button></div>
            <AnimatePresence>
              {!pauseCinema && !settings && transportHover && !flash && (
                <motion.div
                  className="player-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? .1 : .18, ease: "easeOut" }}
                >
                  <motion.div
                    className="player-center-control"
                    initial={{ opacity: 0, x: reduceMotion ? 0 : 22, scale: reduceMotion ? 1 : .88 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: reduceMotion ? 0 : 14, scale: reduceMotion ? 1 : .92 }}
                    transition={{ duration: reduceMotion ? .1 : .24, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <button className="seek-skip" aria-label="Rewind 10 seconds" onClick={() => seekBy(-10)}><RotateCcw /><span>10</span></button>
                  </motion.div>
                  <motion.div
                    className="player-center-control"
                    initial={{ opacity: 0, scale: reduceMotion ? 1 : .78 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: reduceMotion ? 1 : .84 }}
                    transition={{ duration: reduceMotion ? .1 : .27, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <button className="play-main" aria-label={playing ? "Pause" : "Play"} onClick={() => videoRef.current?.paused ? void startVideoPlayback() : pauseVideoPlayback()}><PlayPauseGlyph playing={playing} /></button>
                  </motion.div>
                  <motion.div
                    className="player-center-control"
                    initial={{ opacity: 0, x: reduceMotion ? 0 : -22, scale: reduceMotion ? 1 : .88 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: reduceMotion ? 0 : -14, scale: reduceMotion ? 1 : .92 }}
                    transition={{ duration: reduceMotion ? .1 : .24, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <button className="seek-skip" aria-label="Forward 10 seconds" onClick={() => seekBy(10)}><RotateCw /><span>10</span></button>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="player-bottom">
              <div
                className="seek-wrap"
                onPointerEnter={(event) => { if (!isAppleTouchDevice() || event.pointerType !== "mouse") updateSeekPreview(event); }}
                onPointerMove={(event) => { if (seekingRef.current || !isAppleTouchDevice() || event.pointerType !== "mouse") updateSeekPreview(event); }}
                onPointerLeave={() => { if (!seeking) setSeekPreview(null); }}
                onPointerDown={(event) => { beginUserSeek(); updateSeekPreview(event); if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture(event.pointerId); }}
                onPointerUp={(event) => { commitSeek(); finishUserSeek(); setSeekPreview(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                onPointerCancel={() => { seekTargetRef.current = null; if (scrubRafRef.current !== null) { window.cancelAnimationFrame(scrubRafRef.current); scrubRafRef.current = null; } scrubPendingRef.current = null; setSeekTarget(null); setSeekPreview(null); finishUserSeek(); }}
              >
                {seekPreview && (
                  <div className="seek-preview" style={{ left: `${seekPreview.left}px` }}>
                    <SeekThumbnail item={item} sourceId={source?.Id} time={seekPreview.time} trickplay={trickplay} />
                    <strong>{formatTime(seekPreview.time)}</strong>
                  </div>
                )}
                <input className="seek" aria-label="Seek video" type="range" min={0} max={duration || 1} step="0.1" value={seekTarget ?? position} onChange={(event) => changeSeekTarget(Number(event.target.value))} />
              </div>
              <div className="player-row">
                <button className="player-icon player-bar-play" aria-label={playing ? "Pause" : "Play"} onClick={() => videoRef.current?.paused ? void startVideoPlayback() : pauseVideoPlayback()}><PlayPauseGlyph playing={playing} /></button>
                <div className="player-volume-control">
                  <button className="player-icon" aria-label={muted ? "Unmute" : "Mute"} onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }}>{muted || volume === 0 ? <VolumeX /> : <Volume2 />}</button>
                  <div className="player-volume-slider">
                    <button type="button" aria-label="Decrease volume" onClick={() => changeVolume(volumeRef.current - .1)}>−</button>
                    <input aria-label="Volume, up to 200 percent" type="range" min="0" max="2" step="0.01" value={muted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} />
                    <button type="button" aria-label="Increase volume" onClick={() => changeVolume(volumeRef.current + .1)}>+</button>
                    <output>{Math.round((muted ? 0 : volume) * 100)}%</output>
                  </div>
                </div>
                <span className="timecode"><RollingTimecode video={videoRef.current} playing={playing} position={position} /><span className="timecode-total"> / {formatTime(duration)}</span></span>
                <span className="player-spacer" />
                {item.SeriesId && <button className="player-icon" aria-label="Choose episode" onClick={() => setSettings("episodes")}><ListVideo /></button>}
                {timeline.chapters.length > 0 && <button className="player-icon" aria-label="Choose chapter" onClick={() => setSettings("chapters")}><ListTree /></button>}
                {subtitles.length > 0 && <button className="player-icon" aria-label="Subtitle settings" onClick={() => setSettings("captions")}><Captions /></button>}
                <button className="player-icon" aria-label="AirPlay" onClick={(event) => { event.preventDefault(); event.stopPropagation(); showAirPlayPicker(); }}><Airplay /></button>
                <button className="player-icon" aria-label="Playback settings" onClick={() => setSettings("playback")}><Settings2 /></button>
                <button className="player-icon player-fullscreen" aria-label={viewportFullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={toggleFullscreen}><Expand /></button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {error && <div className={`player-error player-error-action player-issue player-issue-${errorSeverity}`} role="alert">
        <div className="player-issue-copy"><TriangleAlert aria-hidden="true" /><span><strong>{errorSeverity === "warning" ? "Subtitle unavailable" : "Playback interrupted"}</strong>{error}</span></div>
        <div className="player-issue-actions">
          <button type="button" onClick={() => errorSeverity === "warning" ? chooseSubtitle(subtitleIndex) : retryPlayback()}>{errorSeverity === "warning" ? "Retry subtitles" : "Retry"}</button>
          {errorSeverity === "warning" ? <button type="button" onClick={dismissError}>Dismiss</button> : <><button type="button" onClick={closePlayer}>Back</button><button type="button" onClick={copyDiagnostics}>Copy diagnostics</button></>}
        </div>
      </div>}
      {notice && <div className="cloud-media-notice-message player-error" role="status">{notice}</div>}
      <AnimatePresence>
        {flash && (
          <motion.div
            key={flash.key}
            className="shortcut-flash"
            aria-hidden="true"
            initial={{ opacity: 0, scale: reduceMotion ? 1 : .82 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 1.12 }}
            transition={{ duration: reduceMotion ? .12 : .22, ease: [0.22, 1, 0.36, 1] }}
          >
            {flash.icon === "play" && <Play />}
            {flash.icon === "pause" && <Pause />}
            {flash.icon === "forward" && <RotateCw />}
            {flash.icon === "backward" && <RotateCcw />}
            {flash.icon === "volume" && <Volume2 />}
            {flash.icon === "volume-low" && <Volume1 />}
            {flash.icon === "volume-muted" && <VolumeX />}
            {flash.icon === "captions" && <Captions />}
            {flash.icon === "captions-off" && <CaptionsOff />}
            {flash.label && <span>{flash.label}</span>}
          </motion.div>
        )}
      </AnimatePresence>
      <Modal open={settings === "captions"} title="Subtitles" titleIcon={<Captions aria-hidden="true" />} className="player-settings-modal" onClose={() => setSettings(null)}>
        <div className="player-settings player-settings-polished">
          <div className="settings-section">
            <label className="settings-select"><span>Subtitle track</span><select value={subtitleStream?.Index ?? ""} onChange={(event) => chooseSubtitle(event.target.value === "" ? null : Number(event.target.value))}><option value="">Off</option>{subtitles.map((stream) => <option key={stream.Index} value={stream.Index}>{subtitleTrackLabel(stream)}</option>)}</select></label>
          </div>
          {(phonePortrait || smartphoneLandscape) && subtitleTimingControls}
          <div className={`caption-preview${cue ? " caption-preview-live" : ""}`}><span style={{ fontSize: `${Math.max(13, captions.fontSize * .19)}px`, fontWeight: captions.fontWeight, lineHeight: captions.lineHeight, letterSpacing: `${captions.letterSpacing}px`, background: `rgba(0,0,0,${captions.backgroundOpacity})` }}>{cue || "Subtitle preview"}</span></div>
          <section className="settings-group"><h3>Text</h3><div className="settings-presets" role="group" aria-label="Text size presets">{([["small", "Small"], ["default", "Default"], ["large", "Large"]] as const).map(([key, name]) => <button key={key} type="button" className={activeCaptionPreset(captions.fontSize) === key ? "active" : ""} onClick={() => setCaptions({ ...captions, fontSize: captionSizePreset(key) })}>{name}</button>)}</div><div className="settings-section settings-sliders">
            <label><span>Text size <b>{captions.fontSize}%</b></span><input type="range" min="0" max="200" value={captions.fontSize} onChange={(event) => setCaptions({ ...captions, fontSize: captionFontSize(Number(event.target.value)) })} /></label>
            <label><span>Font weight <b>{captions.fontWeight}</b></span><input type="range" min="300" max="800" step="100" value={captions.fontWeight} onChange={(event) => setCaptions({ ...captions, fontWeight: Number(event.target.value) })} /></label>
            <label><span>Line height <b>{captions.lineHeight.toFixed(2)}</b></span><input type="range" min="1.45" max="2" step="0.01" value={captions.lineHeight} onChange={(event) => setCaptions({ ...captions, lineHeight: captionLineHeight(Number(event.target.value)) })} /></label>
            <label><span>Letter spacing <b>{captions.letterSpacing}px</b></span><input type="range" min="-2" max="8" step="0.25" value={captions.letterSpacing} onChange={(event) => setCaptions({ ...captions, letterSpacing: Number(event.target.value) })} /></label>
          </div></section>
          <section className="settings-group"><h3>Position & background</h3><div className="settings-section settings-sliders">
            <label><span>Vertical offset <b>{captionOffset}%</b></span><input type="range" min="0" max="30" value={captionOffset} onChange={(event) => setCaptions({ ...captions, [smartphoneLandscape ? "landscapeOffset" : phonePortrait ? "phonePortraitOffset" : "portraitOffset"]: captionVerticalOffset(Number(event.target.value)) })} /></label>
            <label><span>Background opacity <b>{Math.round(captions.backgroundOpacity * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value={captions.backgroundOpacity} onChange={(event) => setCaptions({ ...captions, backgroundOpacity: Number(event.target.value) })} /></label>
          </div></section>
          {!phonePortrait && !smartphoneLandscape && subtitleTimingControls}
          <div className="settings-actions"><Button variant="ghost" onClick={() => setCaptions(defaultCaptions)}>Reset</Button><Button variant="secondary" onClick={() => setSettings(null)}>Done</Button></div>
        </div>
      </Modal>
      <Modal open={settings === "playback"} title="Settings" titleIcon={<SlidersHorizontal aria-hidden="true" />} className="player-settings-modal" onClose={() => setSettings(null)}>
        <div className="player-settings player-settings-polished">
          {subtitles.length > 0 && <section className="settings-group"><h3>Subtitles</h3><button className="stats-toggle" onClick={() => setSettings("captions")}>Subtitle track and timing<span>Open</span></button></section>}
          <section className="settings-group"><h3>Autoplay</h3><label><input type="checkbox" checked={autoplay} onChange={event => { const enabled = event.target.checked; setAutoplay(enabled); playbackPrefs.current.autoplay = enabled; mediaStorage.setItem(playbackPrefsKey, JSON.stringify(playbackPrefs.current)); if (!enabled) setEndCountdown(null); }} /> Play the next episode or movie automatically</label></section>
          <section className="settings-group"><h3>Playback</h3><div className="settings-speed"><span>Speed</span><div>{[.5, .75, 1, 1.25, 1.5, 2].map((rate) => <button key={rate} className={playbackRate === rate ? "active" : ""} onClick={() => setPlaybackRate(rate)}>{rate}×</button>)}</div></div></section>
          <section className="settings-group"><h3>Quality</h3><label className="settings-select"><span>Streaming quality</span><select aria-label="Streaming quality" value={qualityPreference} onChange={(event) => changeQuality(event.target.value as PlaybackQuality)}>{playbackQualityOptions.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.detail}</option>)}</select></label></section>
          <section className="settings-group"><h3>Picture</h3><div className="settings-choice"><span>Fit</span><div><button className={videoFit === "contain" ? "active" : ""} onClick={() => setVideoFit("contain")}>Fit</button><button className={videoFit === "cover" ? "active" : ""} onClick={() => setVideoFit("cover")}>Fill</button></div></div></section>
          <section className="settings-group settings-audio-volume"><h3>Audio</h3>{audioStreams.length > 1 && <label className="settings-select"><span>Audio track</span><select aria-label="Audio track" value={audioStream?.Index ?? ""} onChange={(event) => changeAudioTrack(Number(event.target.value))}>{audioStreams.map((stream) => <option key={stream.Index} value={stream.Index}>{audioTrackLabel(stream)}</option>)}</select></label>}<label><span>Volume <b>{Math.round((muted ? 0 : volume) * 100)}%</b></span><input aria-label="Volume, up to 200 percent" type="range" min="0" max="2" step="0.01" value={muted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} /></label></section>
          <section className="settings-group"><h3>Diagnostics</h3><button className="settings-diagnostic-entry" onClick={() => { setStatsOpen((open) => !open); setSettings(null); }} aria-expanded={statsOpen}><span className="settings-diagnostic-icon"><Activity aria-hidden="true" /></span><span className="settings-diagnostic-copy"><strong>Stats for nerds</strong><small>Playback, buffer & codecs</small></span><span className="settings-diagnostic-action">{statsOpen ? "Hide" : "Open"}<ChevronRight aria-hidden="true" /></span></button></section>
          <div className="settings-actions"><Button variant="secondary" onClick={() => setSettings(null)}>Done</Button></div>
          <div className="player-settings-suite-wordmark" aria-label="Cloud Media, a Cloud at Home service"><strong>Cloud Media</strong><i aria-hidden="true">·</i><strong>Cloud at Home<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 18.5h10.7a4.3 4.3 0 0 0 .5-8.6A6.2 6.2 0 0 0 6.1 8.2a5.2 5.2 0 0 0 .4 10.3Z" /></svg></strong></div>
        </div>
      </Modal>
      <Modal open={settings === "episodes"} title={item.SeriesName ? `${item.SeriesName} episodes` : "Episodes"} onClose={() => setSettings(null)}>
        <div className="player-episode-picker">
          {seriesEpisodes.length ? seriesEpisodes.map((episode) => (
            <button key={episode.Id} className={episode.Id === item.Id ? "active" : ""} onClick={() => playEpisode(episode)}>
              <span>EPISODE {episode.IndexNumber ?? "—"}</span>
              <strong>{episode.Name}</strong>
              {episode.Id === item.Id && <small>Now playing</small>}
            </button>
          )) : <div className="episode-status">No episodes available.</div>}
        </div>
      </Modal>
      <Modal open={settings === "chapters"} title="Chapters" onClose={() => setSettings(null)}>
        <div className="player-chapter-picker">
          {timeline.chapters.map((chapter, index) => {
            const next = timeline.chapters[index + 1];
            const active = position >= chapter.startSeconds && (!next || position < next.startSeconds);
            return (
              <button key={`${chapter.startSeconds}-${chapter.name}`} className={active ? "active" : ""} onClick={() => { changeSeekTarget(chapter.startSeconds); setSettings(null); }}>
                <span>{formatTime(chapter.startSeconds)}</span><strong>{chapter.name}</strong>{active && <small>Now playing</small>}
              </button>
            );
          })}
        </div>
      </Modal>
    </motion.div>
  );
}

function PlayPauseGlyph({ playing }: { playing: boolean }) {
  // A single glyph that crossfades in place. The old AnimatePresence kept both
  // icons mounted and counter-rotated them, which read as a double-image spin
  // on the large center button. Straight opacity + a whisper of scale is calm.
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.span
        className="playback-glyph"
        key={playing ? "pause" : "play"}
        initial={{ opacity: 0, scale: .9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: .9 }}
        transition={{ duration: .1, ease: "easeOut" }}
      >
        {playing ? <Pause /> : <Play />}
      </motion.span>
    </AnimatePresence>
  );
}

function SeekThumbnail({
  item,
  sourceId,
  time,
  trickplay,
}: {
  item: MediaItem;
  sourceId?: string;
  time: number;
  trickplay: { width: number; details: TrickplayInfo } | null;
}) {
  if (!trickplay || !sourceId) return null;
  const frame = trickplayFrame(time, trickplay.details);
  const displayWidth = 210;
  const scale = displayWidth / trickplay.details.Width;
  const query = new URLSearchParams({ mediaSourceId: sourceId });
  const sprite = `/api/media/proxy/Videos/${item.Id}/Trickplay/${trickplay.width}/${frame.tile}.jpg?${query}`;
  return (
    <div
      className="seek-thumbnail"
      style={{
        width: `${displayWidth}px`,
        height: `${trickplay.details.Height * scale}px`,
        backgroundImage: `url(${sprite})`,
        backgroundSize: `${trickplay.details.Width * trickplay.details.TileWidth * scale}px ${trickplay.details.Height * trickplay.details.TileHeight * scale}px`,
        backgroundPosition: `${-frame.column * displayWidth}px ${-frame.row * trickplay.details.Height * scale}px`,
      }}
    />
  );
}

// Rolling play clock, movie-shaped (H:MM:SS once past the hour).
// The digits roll on a rAF loop reading the video element directly — driving
// them off `timeupdate` (4–66Hz, irregular) landed each whole-second roll at
// a different sub-second phase and read as jittery.
// The rAF runs only while playing; the `position` prop keeps
// paused seeks painted. The span's inner DOM is owned by paintRollingTime,
// so React renders it once and never reconciles the mid-roll markup.
function RollingTimecode({ video, playing, position }: { video: HTMLVideoElement | null; playing: boolean; position: number }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const lastSecondRef = useRef(-1);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !playing) return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const second = Math.floor(video?.currentTime ?? 0);
      if (second === lastSecondRef.current) return;
      lastSecondRef.current = second;
      paintRollingTime(host, formatTime(second));
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [video, playing]);
  useEffect(() => {
    // paused (or first mount): settle to the seek/rest value without a loop
    const host = hostRef.current;
    if (!host || playing) return;
    lastSecondRef.current = Math.floor(position);
    paintRollingTime(host, formatTime(position));
  }, [playing, position]);
  return <span className="timecode-current" ref={hostRef} />;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value)) return "0:00";
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

function captureVideoFrame(video: HTMLVideoElement): string {
  if (!video.videoWidth || !video.videoHeight) return "";
  const width = Math.min(1280, video.videoWidth);
  const height = Math.round(width * video.videoHeight / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", .82);
  } catch {
    return "";
  }
}

function isAppleTouchDevice(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
