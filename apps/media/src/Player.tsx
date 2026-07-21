import Hls from "hls.js";
import {
  Airplay,
  Captions,
  Expand,
  ListVideo,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { Button, Modal } from "@cloud-at-home/ui";
import { createStreamTicket, getPlaybackInfo, getSeriesEpisodes, imageUrl, reportPlayback, subtitleTrackUrl, ticketedStreamUrl, type MediaItem, type PlaybackInfo, type Session } from "./api";
import { activeCueText, airPlayNoticeDurationMs, airPlayUnavailableMessage, captionFontSize, captionLineHeight, captionPrefsVersion, captionVerticalOffset, formatPlaybackStats, fullscreenStrategy, mediaYearLabel, migrateCaptionDefaults, pauseCinemaDelays, pauseSynopsisDurationSeconds, playbackStartPosition, playerKeyboardAction, playerTitleOwners, prefersViewportFullscreen, shouldArmTitleTimer, shouldAutoPictureInPicture, shouldReportProgress, subtitleTrackLabel, titleDisplayDurationMs, trickplayFrame, type TrickplayInfo } from "./playback";

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

const defaultCaptions: CaptionPrefs = { fontSize: 85, fontWeight: 600, lineHeight: 1.52, letterSpacing: 0, phonePortraitOffset: 25, portraitOffset: 12, landscapeOffset: 8, backgroundOpacity: 0.5 };
const playbackPrefsKey = "cloud-media-playback";
const pauseTitleHandoffMs = 500;
type PlaybackPrefs = { muted: boolean; volume: number; rate?: number; fit?: "contain" | "cover"; subtitleLanguage?: string; subtitlesOff?: boolean };

function loadPlaybackPrefs(): PlaybackPrefs {
  try { return { muted: false, volume: 1, ...JSON.parse(localStorage.getItem(playbackPrefsKey) ?? "{}") }; }
  catch { return { muted: false, volume: 1 }; }
}

export function Player({ item, session, fromBeginning = false, onPlayEpisode, onClose }: { item: MediaItem; session: Session; fromBeginning?: boolean; onPlayEpisode?: (episode: MediaItem) => void; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const shellRef = useRef<SafariFullscreenElement>(null);
  const videoRef = useRef<SafariVideo>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const subtitleTrackRef = useRef<HTMLTrackElement | null>(null);
  const subtitleCueListenerRef = useRef<(() => void) | null>(null);
  const nativeFullscreenRef = useRef(false);
  const fullscreenIntentRef = useRef(false);
  const toggleFullscreenRef = useRef<() => void>(() => undefined);
  const initialPlayPendingRef = useRef(true);
  const lastReport = useRef(0);
  const positionRef = useRef(fromBeginning ? 0 : (item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000);
  const stoppedRef = useRef(false);
  const reportQueueRef = useRef<Promise<void>>(Promise.resolve());
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
  const [playing, setPlaying] = useState(false);
  const playbackPrefs = useRef(loadPlaybackPrefs());
  const [muted, setMuted] = useState(playbackPrefs.current.muted);
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
  const [settings, setSettings] = useState<"captions" | "playback" | "episodes" | null>(null);
  const [seriesEpisodes, setSeriesEpisodes] = useState<MediaItem[]>([]);
  const [captions, setCaptions] = useState<CaptionPrefs>(() => {
    try {
      const saved = migrateCaptionDefaults(JSON.parse(localStorage.getItem("cloud-media-captions") ?? "{}"));
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
  const [cue, setCue] = useState("");
  const [subtitleRenderEpoch, setSubtitleRenderEpoch] = useState(0);
  const [seekPreview, setSeekPreview] = useState<{ time: number; left: number } | null>(null);
  const [seeking, setSeeking] = useState(false);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statsOpen, setStatsOpen] = useState(false);
  const [viewportFullscreen, setViewportFullscreen] = useState(false);
  const [, setStatsEpoch] = useState(0);

  const source = info?.MediaSources?.[0];
  const yearLabel = mediaYearLabel(item);
  const pauseTitle = item.SeriesName ?? item.Name;
  const pauseTitleBreak = pauseTitle.lastIndexOf(" ");
  const pauseTitleLead = pauseTitleBreak > 0 ? pauseTitle.slice(0, pauseTitleBreak + 1) : "";
  const pauseTitleTail = pauseTitleBreak > 0 ? pauseTitle.slice(pauseTitleBreak + 1) : pauseTitle;
  const pauseDelays = pauseCinemaDelays(Boolean(item.SeriesName));
  const titleOwners = playerTitleOwners(pauseCinema, titleLingering, pauseTitleHandoff);
  const captionOffset = smartphoneLandscape ? captions.landscapeOffset : phonePortrait ? captions.phonePortraitOffset : captions.portraitOffset;
  const subtitles = useMemo(() => source?.MediaStreams?.filter((stream) => stream.Type === "Subtitle") ?? [], [source]);
  const videoStream = source?.MediaStreams?.find((stream) => stream.Type === "Video");
  const audioStream = source?.MediaStreams?.find((stream) => stream.Type === "Audio");
  const video = videoRef.current;
  const playerBounds = shellRef.current?.getBoundingClientRect();
  const quality = video?.getVideoPlaybackQuality?.();
  const hls = hlsRef.current;
  const hlsLevel = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : undefined;
  const bufferedSeconds = video?.buffered.length
    ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime)
    : 0;
  const playbackStats = formatPlaybackStats({
    width: video?.videoWidth || videoStream?.Width,
    height: video?.videoHeight || videoStream?.Height,
    viewportWidth: playerBounds ? Math.round(playerBounds.width) : undefined,
    viewportHeight: playerBounds ? Math.round(playerBounds.height) : undefined,
    mode: source?.TranscodingUrl ? "Transcoding" : "Direct play",
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
    bufferedSeconds,
    droppedFrames: quality?.droppedVideoFrames,
    totalFrames: quality?.totalVideoFrames,
    bandwidth: hls?.bandwidthEstimate,
    hlsLevel: hlsLevel ? `${hlsLevel.width} × ${hlsLevel.height}${hlsLevel.bitrate ? ` · ${(hlsLevel.bitrate / 1_000_000).toFixed(1)} Mbps` : ""}` : undefined,
    readyState: video?.readyState,
    networkState: video?.networkState,
    rate: playbackRate,
  });
  useEffect(() => {
    if (settings !== "playback") return;
    setStatsEpoch((value) => value + 1);
    const timer = window.setInterval(() => setStatsEpoch((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [settings]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), airPlayNoticeDurationMs);
    return () => window.clearTimeout(timer);
  }, [notice]);
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
    const snapshot = payload();
    const request = () => reportPlayback(event, snapshot, keepalive).catch(() => undefined);
    reportQueueRef.current = reportQueueRef.current.then(request, request);
    return reportQueueRef.current;
  }, [payload]);

  useEffect(() => {
    const supportsHevc = Boolean(videoRef.current?.canPlayType('video/mp4; codecs="hvc1"'));
    getPlaybackInfo(item.Id, session.user.id, supportsHevc).then(setInfo).catch((reason) => setError(String(reason.message ?? reason)));
  }, [item.Id, session.user.id]);

  useEffect(() => {
    if (!source || !videoRef.current) return;
    const video = videoRef.current;
    let cancelled = false;
    let initialPlayAttempts = 0;
    let retryTimer: number | null = null;
    let waitingForCanPlay = false;
    const maxInitialPlayAttempts = 4;
    const paintPausedFrame = () => {
      if (!cancelled && video.paused) setPauseFrame(captureVideoFrame(video));
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
      const target = playbackStartPosition(position, video.duration, fromBeginning);
      if (target > 0 && Math.abs(video.currentTime - target) > .05) {
        video.addEventListener("seeked", startAfterResume, { once: true });
        video.currentTime = target;
        positionRef.current = target;
        return;
      }
      startPlayback();
    };
    void createStreamTicket(item.Id).then((ticket) => {
      if (cancelled) return;
      const direct = `Videos/${item.Id}/stream?static=true&mediaSourceId=${encodeURIComponent(source.Id)}`;
      const target = source.TranscodingUrl?.replace(/^\//, "") ?? direct;
      const url = ticketedStreamUrl(ticket, target);
      if (url.includes(".m3u8") && !video.canPlayType("application/vnd.apple.mpegurl") && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, backBufferLength: 90, renderTextTracksNatively: false });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => data.fatal && setError(data.details));
        hlsRef.current = hls;
      } else {
        video.src = url;
      }
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) applyResume();
      else video.addEventListener("loadedmetadata", applyResume, { once: true });
      void enqueueReport("start");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not create playback session"));
    video.addEventListener("playing", markInitialPlayStarted);
    video.addEventListener("pause", recoverInterruptedInitialPlay);
    return () => {
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
    };
    // Source identity is the lifecycle boundary; payload intentionally reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.Id, fromBeginning]);

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
    const enterPictureInPicture = () => {
      const video = videoRef.current;
      const fullscreenDocument = document as SafariFullscreenDocument;
      if (fullscreenIntentRef.current || document.fullscreenElement || fullscreenDocument.webkitFullscreenElement) return;
      if (!video || !shouldAutoPictureInPicture(video.paused, video.ended, video.readyState)) return;
      try {
        if (video.webkitSupportsPresentationMode?.("picture-in-picture")) {
          if (video.webkitPresentationMode !== "picture-in-picture") video.webkitSetPresentationMode?.("picture-in-picture");
          return;
        }
        if (document.pictureInPictureEnabled && document.pictureInPictureElement !== video) {
          void video.requestPictureInPicture().catch(() => undefined);
        }
      } catch {
        // Safari may reject automatic PiP when the device setting or gesture
        // policy disallows it; playback should continue uninterrupted.
      }
    };
    const onVisibility = () => { if (document.hidden) enterPictureInPicture(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", enterPictureInPicture);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", enterPictureInPicture);
    };
  }, []);

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
      const captionsActive = subtitleIndex !== null;
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
        setTitleLingering(true);
        if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
        if (titleTimerRef.current !== null) window.clearTimeout(titleTimerRef.current);
        controlsTimerRef.current = window.setTimeout(() => setControls(false), 2_800);
        // While paused, pause cinema owns the title handoff. An independent
        // timer can clear the corner title several seconds too early.
        if (!video.paused) titleTimerRef.current = window.setTimeout(() => setTitleLingering(false), titleDisplayDurationMs);
      }

      if (shortcut === "seek-back") video.currentTime = Math.max(0, video.currentTime - 10);
      else if (shortcut === "seek-forward") video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
      else if (shortcut === "toggle") video.paused ? void startVideoPlayback(video) : pauseVideoPlayback(video);
      else if (shortcut === "fullscreen") toggleFullscreenRef.current();
      else if (shortcut === "mute") video.muted = !video.muted;
      else if (shortcut === "volume-up") changeVolume(volumeRef.current + 0.05);
      else if (shortcut === "volume-down") changeVolume(volumeRef.current - 0.05);
      else if (shortcut === "captions") {
        if (!subtitles.length) return;
        if (captionsActive) void chooseSubtitle(null);
        else {
          const preferred = subtitles.find((stream) => stream.Language === playbackPrefs.current.subtitleLanguage);
          void chooseSubtitle((preferred ?? subtitles[0]).Index);
        }
      }
      else if (ownsFontKey) {
        const step = (key === "+" || key === "=") ? 5 : -5;
        setCaptions((current) => ({ ...current, fontSize: captionFontSize(current.fontSize + step) }));
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
  }, [settings, subtitleIndex, subtitles, duration]);

  useEffect(() => {
    localStorage.setItem("cloud-media-captions", JSON.stringify({ ...captions, version: captionPrefsVersion }));
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
    video.playbackRate = playbackPrefs.current.rate ?? 1;
    if (playbackPrefs.current.subtitlesOff || !subtitles.length) return;
    const preferred = subtitles.find((stream) => stream.Language === playbackPrefs.current.subtitleLanguage);
    chooseSubtitle((preferred ?? subtitles[0]).Index);
    // Restore once for each media source after its stream list arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.Id, subtitles]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
    playbackPrefs.current = { ...playbackPrefs.current, rate: playbackRate, fit: videoFit };
    localStorage.setItem(playbackPrefsKey, JSON.stringify(playbackPrefs.current));
  }, [playbackRate, videoFit]);

  useEffect(() => {
    if (playing) {
      setPauseCinema(false);
      setPauseTitleHandoff(false);
      setTitleLingering(true);
      if (titleTimerRef.current !== null) window.clearTimeout(titleTimerRef.current);
      titleTimerRef.current = window.setTimeout(() => setTitleLingering(false), titleDisplayDurationMs);
      return;
    }
    if (titleTimerRef.current !== null) window.clearTimeout(titleTimerRef.current);
    setTitleLingering(true);
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
  }, [playing]);

  const syncSubtitleCue = useCallback(() => {
    if (nativeFullscreenRef.current) { setCue(""); return; }
    const active = subtitleTrackRef.current?.track.activeCues as unknown as ArrayLike<{ text: string }> | null | undefined;
    setCue(activeCueText(active ?? null));
  }, []);

  const cleanupSubtitleTrack = useCallback(() => {
    const track = subtitleTrackRef.current;
    if (track) {
      if (subtitleCueListenerRef.current) track.track.removeEventListener("cuechange", subtitleCueListenerRef.current);
      track.track.mode = "disabled";
      track.remove();
    }
    subtitleCueListenerRef.current = null;
    subtitleTrackRef.current = null;
    setCue("");
  }, []);

  useEffect(() => cleanupSubtitleTrack, [cleanupSubtitleTrack]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const disableUnmanagedTracks = () => {
      for (let index = 0; index < video.textTracks.length; index += 1) {
        const track = video.textTracks[index];
        if (track !== subtitleTrackRef.current?.track) track.mode = "disabled";
      }
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
      setCue("");
      return;
    }
    const selectedTrack = subtitleTrackRef.current?.track;
    if (selectedTrack && subtitleIndex !== null) {
      selectedTrack.mode = nativeFullscreenRef.current ? "showing" : "hidden";
      syncSubtitleCue();
    }
  }, [pauseCinema, subtitleIndex, syncSubtitleCue]);

  useEffect(() => {
    const invalidateSubtitleLayer = () => {
      if (document.hidden) return;
      syncSubtitleCue();
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
  }, [syncSubtitleCue]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const setNativeFullscreen = (active: boolean) => {
      nativeFullscreenRef.current = active;
      const track = subtitleTrackRef.current?.track;
      if (track && subtitleIndex !== null) track.mode = active ? "showing" : "hidden";
      if (active) setCue(""); else syncSubtitleCue();
    };
    const begin = () => { fullscreenIntentRef.current = true; setNativeFullscreen(true); };
    const end = () => { fullscreenIntentRef.current = false; setNativeFullscreen(false); };
    const standardChange = () => {
      const fullscreenDocument = document as SafariFullscreenDocument;
      const active = Boolean(document.fullscreenElement || fullscreenDocument.webkitFullscreenElement);
      fullscreenIntentRef.current = active;
      if (!active) setViewportFullscreen(false);
      setNativeFullscreen(document.fullscreenElement === video);
    };
    const presentationChange = () => {
      fullscreenIntentRef.current = video.webkitPresentationMode === "fullscreen";
      setNativeFullscreen(video.webkitPresentationMode === "fullscreen" || video.webkitPresentationMode === "picture-in-picture");
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
  }, [subtitleIndex, syncSubtitleCue]);

  function chooseSubtitle(index: number | null) {
    setSubtitleIndex(index);
    const selected = subtitles.find((entry) => entry.Index === index);
    playbackPrefs.current = {
      ...playbackPrefs.current,
      subtitleLanguage: selected?.Language,
      subtitlesOff: index === null,
    };
    localStorage.setItem(playbackPrefsKey, JSON.stringify(playbackPrefs.current));
    setCue("");
    const video = videoRef.current;
    if (!video || !source) return;
    cleanupSubtitleTrack();
    [...video.querySelectorAll("track")].forEach((node) => {
      node.track.mode = "disabled";
      node.remove();
    });
    if (index === null) { setError(""); return; }
    if (!selected) { setError("Could not load subtitle track."); return; }
    setError("");
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = subtitleTrackLabel(selected);
    track.srclang = nativeSubtitleLanguage(selected.Language);
    track.default = true;
    track.addEventListener("load", () => {
      subtitleTrackRef.current = track;
      track.track.mode = nativeFullscreenRef.current ? "showing" : "hidden";
      subtitleCueListenerRef.current = syncSubtitleCue;
      track.track.addEventListener("cuechange", syncSubtitleCue);
      syncSubtitleCue();
      setError("");
    }, { once: true });
    track.addEventListener("error", () => setError("Could not load subtitle track."), { once: true });
    track.src = subtitleTrackUrl(item.Id, source.Id, index);
    track.track.mode = "hidden";
    subtitleTrackRef.current = track;
    video.appendChild(track);
    track.track.mode = nativeFullscreenRef.current ? "showing" : "hidden";
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
      if (Math.abs(video.currentTime - target) > .05) video.currentTime = target;
      positionRef.current = target;
      setPosition(target);
    }
    seekTargetRef.current = null;
    setSeekTarget(null);
  }

  function changeSeekTarget(target: number) {
    seekTargetRef.current = target;
    setSeekTarget(target);
    // During a pointer drag, scrub the video live (rAF-throttled) so the frame
    // tracks the thumb. Keyboard/track-click changes commit immediately.
    if (seekingRef.current) scheduleScrub(target);
    else commitSeek(target);
  }

  function showAirPlayPicker() {
    const video = videoRef.current;
    if (!video) return;
    setNotice("");
    if (typeof video.webkitShowPlaybackTargetPicker === "function") {
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
    localStorage.setItem(playbackPrefsKey, JSON.stringify(playbackPrefs.current));
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

  function handlePlayerMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    setControls(true);
    if (transportTimerRef.current !== null) window.clearTimeout(transportTimerRef.current);
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
    if (shouldArmTitleTimer(titleLingering) && !videoRef.current?.paused) {
      setTitleLingering(true);
      if (titleTimerRef.current !== null) window.clearTimeout(titleTimerRef.current);
      titleTimerRef.current = window.setTimeout(() => setTitleLingering(false), titleDisplayDurationMs);
    }
    const target = event.target as Element;
    const overControl = Boolean(target.closest(".player-controls button, .seek-wrap, .player-settings"));
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
    stoppedRef.current = true;
    void enqueueReport("stop").finally(() => onPlayEpisode(episode));
  }

  return (
    <motion.div ref={shellRef} className={`player-shell ${controls ? "" : "player-controls-hidden"} ${pauseCinema ? "player-pause-cinema" : ""} ${viewportFullscreen ? "player-viewport-fullscreen" : ""} ${isAppleTouchDevice() ? "player-apple-touch" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseMove={handlePlayerMouseMove} onMouseLeave={() => {
      setTransportHover(false);
      setControls(false);
    }}>
      <video
        ref={videoRef}
        className="player-video"
        style={{ objectFit: videoFit }}
        playsInline
        autoPlay
        x-webkit-airplay="allow"
        onPlay={(event) => restorePlaybackAudio(event.currentTarget)}
        onPlaying={() => { initialPlayPendingRef.current = false; setPlaying(true); setPauseCinema(false); setPauseTitleHandoff(false); setTitleLingering(true); }}
        onPause={(event) => { setPlaying(false); setPauseFrame(captureVideoFrame(event.currentTarget)); report(true); }}
        onTimeUpdate={(event) => { positionRef.current = event.currentTarget.currentTime; setPosition(event.currentTarget.currentTime); syncSubtitleCue(); report(); }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted);
          const effectiveVolume = volumeRef.current > 1 && event.currentTarget.volume === 1 ? volumeRef.current : event.currentTarget.volume;
          volumeRef.current = effectiveVolume;
          setVolume(effectiveVolume);
          playbackPrefs.current = { ...playbackPrefs.current, muted: event.currentTarget.muted, volume: effectiveVolume };
          localStorage.setItem(playbackPrefsKey, JSON.stringify(playbackPrefs.current));
        }}
        onSeeked={() => { positionRef.current = videoRef.current?.currentTime ?? positionRef.current; if (videoRef.current?.paused) setPauseFrame(captureVideoFrame(videoRef.current)); syncSubtitleCue(); report(true); }}
        onClick={(event) => event.currentTarget.paused ? void startVideoPlayback(event.currentTarget) : pauseVideoPlayback(event.currentTarget)}
      />
      {!playing && pauseFrame && <img className="player-paused-frame" src={pauseFrame} alt="" aria-hidden="true" style={{ objectFit: videoFit }} />}
      <AnimatePresence>
        {titleOwners.pause && (
          <motion.div className="pause-cinema" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .65, ease: [0.22, 1, 0.36, 1] }}>
            <motion.div className="pause-cinema-art" style={{ backgroundImage: `url(${pauseFrame || imageUrl(item, item.BackdropImageTags?.length ? "Backdrop" : "Primary", 1800)})` }} initial={{ scale: 1.055 }} animate={{ scale: 1.02 }} transition={{ duration: 1.1, ease: "easeOut" }} />
            <div className="pause-cinema-shade" />
            <div className="pause-cinema-copy">
              <div className="pause-cinema-heading">
                <motion.h1 initial={{ opacity: 0, x: reduceMotion ? 0 : -22 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: pauseDelays.title, duration: reduceMotion ? .22 : .58, ease: [0.22, 1, 0.36, 1] }}>{pauseTitleLead}<span className="pause-title-tail">{pauseTitleTail}{yearLabel && <motion.small initial={{ opacity: 0, x: reduceMotion ? 0 : -18, scale: reduceMotion ? 1 : .96 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ delay: pauseDelays.year, duration: reduceMotion ? .22 : .56, ease: [0.22, 1, 0.36, 1] }}>{yearLabel}</motion.small>}</span></motion.h1>
              </div>
              {item.SeriesName && <motion.h2 initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: pauseDelays.episode, duration: reduceMotion ? .22 : .56, ease: [0.22, 1, 0.36, 1] }}>{item.Name}</motion.h2>}
              {item.Overview && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: pauseDelays.synopsis, duration: reduceMotion ? .22 : pauseSynopsisDurationSeconds, ease: [0.22, 1, 0.36, 1] }}>{item.Overview}</motion.p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {cue && !pauseCinema && <div key={subtitleRenderEpoch} data-render-epoch={subtitleRenderEpoch} className="subtitle-layer" style={{ bottom: `${captionOffset}%`, fontSize: `clamp(${18 * captions.fontSize / 100}px, ${2.1 * captions.fontSize / 100}vw, ${48 * captions.fontSize / 100}px)`, fontWeight: captions.fontWeight, lineHeight: captions.lineHeight, letterSpacing: `${captions.letterSpacing}px` }}><span style={{ background: `rgba(0,0,0,${captions.backgroundOpacity})` }}>{cue}</span></div>}
      <div className="player-vignette" />
      <AnimatePresence>
        {titleOwners.corner && (
          <motion.div className="player-title-block" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .5, ease: [0.22, 1, 0.36, 1] }}>
            <div className="player-title-line"><strong>{item.SeriesName ?? item.Name}</strong>{yearLabel && <small>{yearLabel}</small>}</div>{item.SeriesName && <span>{item.Name}</span>}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {controls && (
          <motion.div className="player-controls" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="player-top"><button className="player-icon" aria-label="Close player" onClick={closePlayer}><X /></button></div>
            <AnimatePresence>
              {!pauseCinema && !settings && transportHover && (
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
                    <button className="seek-skip" aria-label="Rewind 10 seconds" onClick={() => { if (videoRef.current) videoRef.current.currentTime -= 10; }}><RotateCcw /><span>10</span></button>
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
                    <button className="seek-skip" aria-label="Forward 10 seconds" onClick={() => { if (videoRef.current) videoRef.current.currentTime += 10; }}><RotateCw /><span>10</span></button>
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
                onPointerDown={(event) => { seekingRef.current = true; setSeeking(true); updateSeekPreview(event); if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture(event.pointerId); }}
                onPointerUp={(event) => { seekingRef.current = false; setSeeking(false); commitSeek(); setSeekPreview(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                onPointerCancel={() => { seekingRef.current = false; seekTargetRef.current = null; if (scrubRafRef.current !== null) { window.cancelAnimationFrame(scrubRafRef.current); scrubRafRef.current = null; } scrubPendingRef.current = null; setSeeking(false); setSeekTarget(null); setSeekPreview(null); }}
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
                <span className="timecode"><span>{formatTime(position)}</span><span className="timecode-total"> / {formatTime(duration)}</span></span>
                <span className="player-spacer" />
                {item.SeriesId && <button className="player-icon" aria-label="Choose episode" onClick={() => setSettings("episodes")}><ListVideo /></button>}
                {subtitles.length > 0 && <button className="player-icon" aria-label="Subtitle settings" onClick={() => setSettings("captions")}><Captions /></button>}
                <button className="player-icon" aria-label="AirPlay" onClick={(event) => { event.preventDefault(); event.stopPropagation(); showAirPlayPicker(); }}><Airplay /></button>
                <button className="player-icon" aria-label="Playback settings" onClick={() => setSettings("playback")}><Settings2 /></button>
                <button className="player-icon" aria-label={viewportFullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={toggleFullscreen}><Expand /></button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {error && <div className="player-error">{error}</div>}
      {notice && <div className="player-error player-notice" role="status">{notice}</div>}
      <Modal open={settings === "captions"} title="Subtitles" onClose={() => setSettings(null)}>
        <div className="player-settings player-settings-polished">
          <header className="settings-heading"><Captions /><div><strong>Caption appearance</strong><span>Changes save automatically on this device</span></div></header>
          <div className="settings-section">
            <label className="settings-select"><span>Subtitle track</span><select value={subtitleIndex ?? ""} onChange={(event) => chooseSubtitle(event.target.value === "" ? null : Number(event.target.value))}><option value="">Off</option>{subtitles.map((stream) => <option key={stream.Index} value={stream.Index}>{subtitleTrackLabel(stream)}</option>)}</select></label>
          </div>
          <div className="caption-preview"><span style={{ fontSize: `${Math.max(13, captions.fontSize * .19)}px`, fontWeight: captions.fontWeight, lineHeight: captions.lineHeight, letterSpacing: `${captions.letterSpacing}px`, background: `rgba(0,0,0,${captions.backgroundOpacity})` }}>Subtitle preview</span></div>
          <section className="settings-group"><h3>Text</h3><div className="settings-section settings-sliders">
            <label><span>Text size <b>{captions.fontSize}%</b></span><input type="range" min="0" max="200" value={captions.fontSize} onChange={(event) => setCaptions({ ...captions, fontSize: captionFontSize(Number(event.target.value)) })} /></label>
            <label><span>Font weight <b>{captions.fontWeight}</b></span><input type="range" min="300" max="800" step="100" value={captions.fontWeight} onChange={(event) => setCaptions({ ...captions, fontWeight: Number(event.target.value) })} /></label>
            <label><span>Line height <b>{captions.lineHeight.toFixed(2)}</b></span><input type="range" min="1.45" max="2" step="0.01" value={captions.lineHeight} onChange={(event) => setCaptions({ ...captions, lineHeight: captionLineHeight(Number(event.target.value)) })} /></label>
            <label><span>Letter spacing <b>{captions.letterSpacing}px</b></span><input type="range" min="-2" max="8" step="0.25" value={captions.letterSpacing} onChange={(event) => setCaptions({ ...captions, letterSpacing: Number(event.target.value) })} /></label>
          </div></section>
          <section className="settings-group"><h3>Position & background</h3><div className="settings-section settings-sliders">
            <label><span>Vertical offset <b>{captionOffset}%</b></span><input type="range" min="0" max="30" value={captionOffset} onChange={(event) => setCaptions({ ...captions, [smartphoneLandscape ? "landscapeOffset" : phonePortrait ? "phonePortraitOffset" : "portraitOffset"]: captionVerticalOffset(Number(event.target.value)) })} /></label>
            <label><span>Background opacity <b>{Math.round(captions.backgroundOpacity * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value={captions.backgroundOpacity} onChange={(event) => setCaptions({ ...captions, backgroundOpacity: Number(event.target.value) })} /></label>
          </div></section>
          <div className="settings-actions"><Button variant="ghost" onClick={() => setCaptions(defaultCaptions)}>Reset</Button><Button variant="secondary" onClick={() => setSettings(null)}>Done</Button></div>
        </div>
      </Modal>
      <Modal open={settings === "playback"} title="Settings" onClose={() => setSettings(null)}>
        <div className="player-settings player-settings-polished">
          <header className="settings-heading"><SlidersHorizontal /><div><strong>Playback settings</strong><span>Speed, picture, audio, and diagnostics</span></div></header>
          <section className="settings-group"><h3>Playback</h3><div className="settings-speed"><span>Speed</span><div>{[.5, .75, 1, 1.25, 1.5, 2].map((rate) => <button key={rate} className={playbackRate === rate ? "active" : ""} onClick={() => setPlaybackRate(rate)}>{rate}×</button>)}</div></div></section>
          <section className="settings-group"><h3>Picture</h3><div className="settings-choice"><span>Fit</span><div><button className={videoFit === "contain" ? "active" : ""} onClick={() => setVideoFit("contain")}>Fit</button><button className={videoFit === "cover" ? "active" : ""} onClick={() => setVideoFit("cover")}>Fill</button></div></div></section>
          <section className="settings-group"><h3>Audio</h3><label><span>Volume <b>{Math.round((muted ? 0 : volume) * 100)}%</b></span><input aria-label="Volume, up to 200 percent" type="range" min="0" max="2" step="0.01" value={muted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} /></label></section>
          <section className="settings-group"><h3>Diagnostics</h3><button className="stats-toggle" onClick={() => setStatsOpen((open) => !open)} aria-expanded={statsOpen}>Stats for nerds <span>{statsOpen ? "Hide" : "Show"}</span></button>
          {statsOpen && <div className="stats-panel">{playbackStats.map(([label, value]) => <div key={label}><span>{label}</span><strong title={value}>{value}</strong></div>)}</div>}</section>
          <div className="settings-actions"><Button variant="secondary" onClick={() => setSettings(null)}>Done</Button></div>
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

function nativeSubtitleLanguage(language?: string): string {
  const normalized = (language ?? "").toLowerCase();
  const codes: Record<string, string> = {
    eng: "en", en: "en", zho: "zh", chi: "zh", cmn: "zh", zh: "zh",
    spa: "es", es: "es", fra: "fr", fre: "fr", fr: "fr", deu: "de", ger: "de", de: "de",
    jpn: "ja", ja: "ja", kor: "ko", ko: "ko", por: "pt", pt: "pt", ita: "it", it: "it",
    rus: "ru", ru: "ru", ara: "ar", ar: "ar", hin: "hi", hi: "hi",
  };
  return codes[normalized] ?? (normalized && normalized !== "und" ? normalized : "en");
}
