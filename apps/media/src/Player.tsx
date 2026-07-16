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
import { flushSync } from "react-dom";
import type { PointerEvent as ReactPointerEvent } from "react";

import { Button, Modal } from "@cloud-at-home/ui";
import { createStreamTicket, getPlaybackInfo, getSeriesEpisodes, imageUrl, loadSubtitleTrack, reportPlayback, ticketedStreamUrl, type MediaItem, type PlaybackInfo, type Session } from "./api";
import { activeCueText, airPlayNoticeDurationMs, airPlayUnavailableMessage, captionFontSize, captionLineHeight, captionPrefsVersion, captionVerticalOffset, formatPlaybackStats, mediaYearLabel, migrateCaptionDefaults, pauseCinemaDelays, playbackStartPosition, shouldAutoPictureInPicture, shouldReportProgress, subtitleTrackLabel, trickplayFrame, usesNativeVideoFullscreen, type TrickplayInfo } from "./playback";

type SafariVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitEnterFullscreen?: () => void;
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

const defaultCaptions: CaptionPrefs = { fontSize: 85, fontWeight: 600, lineHeight: 1.45, letterSpacing: 0, phonePortraitOffset: 25, portraitOffset: 12, landscapeOffset: 8, backgroundOpacity: 0.5 };
const playbackPrefsKey = "cloud-media-playback";

type PlaybackPrefs = { muted: boolean; volume: number; rate?: number; fit?: "contain" | "cover"; subtitleLanguage?: string; subtitlesOff?: boolean };

function loadPlaybackPrefs(): PlaybackPrefs {
  try { return { muted: false, volume: 1, ...JSON.parse(localStorage.getItem(playbackPrefsKey) ?? "{}") }; }
  catch { return { muted: false, volume: 1 }; }
}

export function Player({ item, session, fromBeginning = false, onPlayEpisode, onClose }: { item: MediaItem; session: Session; fromBeginning?: boolean; onPlayEpisode?: (episode: MediaItem) => void; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const shellRef = useRef<SafariFullscreenElement>(null);
  const videoRef = useRef<SafariVideo>(null);
  const hlsRef = useRef<Hls | null>(null);
  const subtitleTrackRef = useRef<HTMLTrackElement | null>(null);
  const subtitleCueListenerRef = useRef<(() => void) | null>(null);
  const subtitleBlobUrlRef = useRef<string | null>(null);
  const subtitleLoadRef = useRef(0);
  const nativeFullscreenRef = useRef(false);
  const lastReport = useRef(0);
  const positionRef = useRef(fromBeginning ? 0 : (item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000);
  const stoppedRef = useRef(false);
  const reportQueueRef = useRef<Promise<void>>(Promise.resolve());
  const transportTimerRef = useRef<number | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const seekingRef = useRef(false);
  const seekTargetRef = useRef<number | null>(null);
  const [info, setInfo] = useState<PlaybackInfo | null>(null);
  const [playing, setPlaying] = useState(false);
  const playbackPrefs = useRef(loadPlaybackPrefs());
  const [muted, setMuted] = useState(playbackPrefs.current.muted);
  const [position, setPosition] = useState(fromBeginning ? 0 : (item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000);
  const [duration, setDuration] = useState((item.RunTimeTicks ?? 0) / 10_000_000);
  const [controls, setControls] = useState(true);
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
  const captionOffset = smartphoneLandscape ? captions.landscapeOffset : phonePortrait ? captions.phonePortraitOffset : captions.portraitOffset;
  const subtitles = useMemo(() => source?.MediaStreams?.filter((stream) => stream.Type === "Subtitle") ?? [], [source]);
  const videoStream = source?.MediaStreams?.find((stream) => stream.Type === "Video");
  const audioStream = source?.MediaStreams?.find((stream) => stream.Type === "Audio");
  const video = videoRef.current;
  const quality = video?.getVideoPlaybackQuality?.();
  const bufferedSeconds = video?.buffered.length
    ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime)
    : 0;
  const playbackStats = formatPlaybackStats({
    width: video?.videoWidth || videoStream?.Width,
    height: video?.videoHeight || videoStream?.Height,
    mode: source?.TranscodingUrl ? "Transcoding" : "Direct play",
    container: source?.Container,
    videoCodec: videoStream?.Codec,
    audioCodec: audioStream?.Codec,
    bufferedSeconds,
    droppedFrames: quality?.droppedVideoFrames,
    totalFrames: quality?.totalVideoFrames,
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
    getPlaybackInfo(item.Id, session.user.id).then(setInfo).catch((reason) => setError(String(reason.message ?? reason)));
  }, [item.Id, session.user.id]);

  useEffect(() => {
    if (!source || !videoRef.current) return;
    const video = videoRef.current;
    let cancelled = false;
    const applyResume = () => {
      const target = playbackStartPosition(position, video.duration, fromBeginning);
      if (target > 0) { video.currentTime = target; positionRef.current = target; }
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
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", applyResume);
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
      const video = videoRef.current;
      if (!video) return;
      if (["ArrowLeft", "ArrowRight", " ", "k", "j", "l", "f", "m"].includes(event.key.toLowerCase())) event.preventDefault();
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "j") video.currentTime = Math.max(0, video.currentTime - 10);
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "l") video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
      if (event.key === " " || event.key.toLowerCase() === "k") video.paused ? void video.play() : video.pause();
      if (event.key.toLowerCase() === "f") toggleFullscreen();
      if (event.key.toLowerCase() === "m") video.muted = !video.muted;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings]);

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
    if (playbackPrefs.current.subtitlesOff) return;
    const preferred = subtitles.find((stream) => stream.Language === playbackPrefs.current.subtitleLanguage);
    if (preferred) chooseSubtitle(preferred.Index);
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
    if (playing) { setPauseCinema(false); return; }
    const timer = window.setTimeout(() => { setPauseCinema(true); setControls(false); }, 10_000);
    return () => window.clearTimeout(timer);
  }, [playing, position]);

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
    if (subtitleBlobUrlRef.current) URL.revokeObjectURL(subtitleBlobUrlRef.current);
    subtitleBlobUrlRef.current = null;
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
    const begin = () => setNativeFullscreen(true);
    const end = () => setNativeFullscreen(false);
    const standardChange = () => setNativeFullscreen(document.fullscreenElement === video);
    const presentationChange = () => setNativeFullscreen(video.webkitPresentationMode === "fullscreen" || video.webkitPresentationMode === "picture-in-picture");
    video.addEventListener("webkitbeginfullscreen", begin);
    video.addEventListener("webkitendfullscreen", end);
    video.addEventListener("webkitpresentationmodechanged", presentationChange);
    document.addEventListener("fullscreenchange", standardChange);
    return () => {
      video.removeEventListener("webkitbeginfullscreen", begin);
      video.removeEventListener("webkitendfullscreen", end);
      video.removeEventListener("webkitpresentationmodechanged", presentationChange);
      document.removeEventListener("fullscreenchange", standardChange);
    };
  }, [subtitleIndex, syncSubtitleCue]);

  async function chooseSubtitle(index: number | null) {
    const loadId = ++subtitleLoadRef.current;
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
    let trackUrl: string;
    try { trackUrl = await loadSubtitleTrack(item.Id, source.Id, index); }
    catch (reason) {
      if (loadId === subtitleLoadRef.current) setError(`Could not load subtitle track. ${reason instanceof Error ? reason.message : "Please try again."}`);
      return;
    }
    if (loadId !== subtitleLoadRef.current) { URL.revokeObjectURL(trackUrl); return; }
    subtitleBlobUrlRef.current = trackUrl;
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
    track.src = trackUrl;
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

  function commitSeek(target = seekTargetRef.current) {
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
    // Keyboard changes and track clicks do not begin a pointer drag.
    if (!seekingRef.current) commitSeek(target);
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

  function toggleFullscreen() {
    const fullscreenDocument = document as SafariFullscreenDocument;
    if (document.fullscreenElement || fullscreenDocument.webkitFullscreenElement) {
      const exit = document.exitFullscreen?.bind(document) ?? fullscreenDocument.webkitExitFullscreen?.bind(fullscreenDocument);
      const result = exit?.();
      if (result instanceof Promise) void result.catch(() => undefined);
      return;
    }
    if (viewportFullscreen) { setViewportFullscreen(false); return; }
    if (usesNativeVideoFullscreen(navigator.userAgent, navigator.maxTouchPoints)) {
      const video = videoRef.current;
      if (typeof video?.webkitEnterFullscreen === "function") {
        try {
          const track = subtitleTrackRef.current?.track;
          nativeFullscreenRef.current = true;
          flushSync(() => setCue(""));
          if (track && subtitleIndex !== null) track.mode = "showing";
          video.webkitEnterFullscreen();
        }
        catch {
          nativeFullscreenRef.current = false;
          const track = subtitleTrackRef.current?.track;
          if (track && subtitleIndex !== null) track.mode = "hidden";
          syncSubtitleCue();
          setViewportFullscreen(true);
          window.scrollTo(0, 0);
        }
      } else {
        setViewportFullscreen(true);
        window.scrollTo(0, 0);
      }
      return;
    }
    const shell = shellRef.current;
    if (!shell) return;
    const request = shell.requestFullscreen?.bind(shell) ?? shell.webkitRequestFullscreen?.bind(shell);
    if (!request) {
      setViewportFullscreen(true);
      window.scrollTo(0, 0);
      return;
    }
    const result = request?.();
    if (result instanceof Promise) void result.catch(() => {
      setViewportFullscreen(true);
      window.scrollTo(0, 0);
    });
  }

  function handlePlayerMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    setControls(true);
    if (transportTimerRef.current !== null) window.clearTimeout(transportTimerRef.current);
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
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
      transportTimerRef.current = window.setTimeout(() => setTransportHover(false), inTransportArea ? 10_000 : 900);
      controlsTimerRef.current = window.setTimeout(() => setControls(false), nearControlZone ? 10_000 : 2_800);
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
    <motion.div ref={shellRef} className={`player-shell ${controls ? "" : "player-controls-hidden"} ${pauseCinema ? "player-pause-cinema" : ""} ${viewportFullscreen ? "player-viewport-fullscreen" : ""} ${isAppleTouchDevice() ? "player-apple-touch" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseMove={handlePlayerMouseMove} onMouseLeave={() => { setTransportHover(false); setControls(false); }}>
      <video
        ref={videoRef}
        className="player-video"
        style={{ objectFit: videoFit }}
        playsInline
        autoPlay
        x-webkit-airplay="allow"
        onPlay={() => { setPlaying(true); setPauseCinema(false); }}
        onPause={(event) => { setPlaying(false); setPauseFrame(captureVideoFrame(event.currentTarget)); report(true); }}
        onTimeUpdate={(event) => { positionRef.current = event.currentTarget.currentTime; setPosition(event.currentTarget.currentTime); syncSubtitleCue(); report(); }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted);
          playbackPrefs.current = { ...playbackPrefs.current, muted: event.currentTarget.muted, volume: event.currentTarget.volume };
          localStorage.setItem(playbackPrefsKey, JSON.stringify(playbackPrefs.current));
        }}
        onSeeked={() => { positionRef.current = videoRef.current?.currentTime ?? positionRef.current; if (videoRef.current?.paused) setPauseFrame(captureVideoFrame(videoRef.current)); syncSubtitleCue(); report(true); }}
        onClick={(event) => event.currentTarget.paused ? void event.currentTarget.play() : event.currentTarget.pause()}
      />
      <AnimatePresence>
        {pauseCinema && (
          <motion.div className="pause-cinema" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .65, ease: [0.22, 1, 0.36, 1] }}>
            <motion.div className="pause-cinema-art" style={{ backgroundImage: `url(${pauseFrame || imageUrl(item, item.BackdropImageTags?.length ? "Backdrop" : "Primary", 1800)})` }} initial={{ scale: 1.055 }} animate={{ scale: 1.02 }} transition={{ duration: 1.1, ease: "easeOut" }} />
            <div className="pause-cinema-shade" />
            <div className="pause-cinema-copy">
              <div className="pause-cinema-heading">
                <motion.h1 layoutId={`player-title-${item.Id}`} initial={{ opacity: 0, x: reduceMotion ? 0 : -22 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: pauseDelays.title, duration: reduceMotion ? .22 : .58, ease: [0.22, 1, 0.36, 1] }}>{pauseTitleLead}<span className="pause-title-tail">{pauseTitleTail}{yearLabel && <motion.small initial={{ opacity: 0, x: reduceMotion ? 0 : -18, scale: reduceMotion ? 1 : .96 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ delay: pauseDelays.year, duration: reduceMotion ? .22 : .56, ease: [0.22, 1, 0.36, 1] }}>{yearLabel}</motion.small>}</span></motion.h1>
              </div>
              {item.SeriesName && <motion.h2 initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: pauseDelays.episode, duration: reduceMotion ? .22 : .56, ease: [0.22, 1, 0.36, 1] }}>{item.Name}</motion.h2>}
              {item.Overview && <motion.p initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: pauseDelays.synopsis, duration: reduceMotion ? .22 : .62, ease: [0.22, 1, 0.36, 1] }}>{item.Overview}</motion.p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {cue && !pauseCinema && <div key={subtitleRenderEpoch} data-render-epoch={subtitleRenderEpoch} className="subtitle-layer" style={{ bottom: `${captionOffset}%`, fontSize: `clamp(${18 * captions.fontSize / 100}px, ${2.1 * captions.fontSize / 100}vw, ${48 * captions.fontSize / 100}px)`, fontWeight: captions.fontWeight, lineHeight: captions.lineHeight, letterSpacing: `${captions.letterSpacing}px` }}><span style={{ background: `rgba(0,0,0,${captions.backgroundOpacity})` }}>{cue}</span></div>}
      <div className="player-vignette" />
      <AnimatePresence>
        {controls && (
          <motion.div className="player-controls" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="player-top"><button className="player-icon" aria-label="Close player" onClick={closePlayer}><X /></button>{!pauseCinema && <div><div className="player-title-line"><motion.strong layoutId={`player-title-${item.Id}`}>{item.SeriesName ?? item.Name}</motion.strong>{yearLabel && <small>{yearLabel}</small>}</div>{item.SeriesName && <span>{item.Name}</span>}</div>}</div>
            {!pauseCinema && !settings && <div className={`player-center ${transportHover ? "transport-hover" : ""}`}>
              <button className="seek-skip" aria-label="Rewind 10 seconds" onClick={() => { if (videoRef.current) videoRef.current.currentTime -= 10; }}><RotateCcw /><span>10</span></button>
              <button className="play-main" onClick={() => videoRef.current?.paused ? void videoRef.current?.play() : videoRef.current?.pause()}><PlayPauseGlyph playing={playing} /></button>
              <button className="seek-skip" aria-label="Forward 10 seconds" onClick={() => { if (videoRef.current) videoRef.current.currentTime += 10; }}><RotateCw /><span>10</span></button>
            </div>}
            <div className="player-bottom">
              <div
                className="seek-wrap"
                onPointerEnter={(event) => { if (!isAppleTouchDevice() || event.pointerType !== "mouse") updateSeekPreview(event); }}
                onPointerMove={(event) => { if (seekingRef.current || !isAppleTouchDevice() || event.pointerType !== "mouse") updateSeekPreview(event); }}
                onPointerLeave={() => { if (!seeking) setSeekPreview(null); }}
                onPointerDown={(event) => { seekingRef.current = true; setSeeking(true); updateSeekPreview(event); if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture(event.pointerId); }}
                onPointerUp={(event) => { seekingRef.current = false; setSeeking(false); commitSeek(); setSeekPreview(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                onPointerCancel={() => { seekingRef.current = false; seekTargetRef.current = null; setSeeking(false); setSeekTarget(null); setSeekPreview(null); }}
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
                <button className="player-icon player-bar-play" aria-label={playing ? "Pause" : "Play"} onClick={() => videoRef.current?.paused ? void videoRef.current.play() : videoRef.current?.pause()}><PlayPauseGlyph playing={playing} /></button>
                <button className="player-icon" onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }}>{muted ? <VolumeX /> : <Volume2 />}</button>
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
          <div className="settings-intro"><Captions /><div><strong>Caption appearance</strong><span>Saved automatically on this device</span></div></div>
          <div className="caption-preview"><span style={{ fontSize: `${Math.max(13, captions.fontSize * .19)}px`, fontWeight: captions.fontWeight, lineHeight: captions.lineHeight, letterSpacing: `${captions.letterSpacing}px`, background: `rgba(0,0,0,${captions.backgroundOpacity})` }}>Subtitle preview</span></div>
          <div className="settings-section">
            <label className="settings-select"><span>Subtitle track</span><select value={subtitleIndex ?? ""} onChange={(event) => chooseSubtitle(event.target.value === "" ? null : Number(event.target.value))}><option value="">Off</option>{subtitles.map((stream) => <option key={stream.Index} value={stream.Index}>{subtitleTrackLabel(stream)}</option>)}</select></label>
          </div>
          <div className="settings-section settings-sliders">
            <label><span>Text size <b>{captions.fontSize}%</b></span><input type="range" min="0" max="200" value={captions.fontSize} onChange={(event) => setCaptions({ ...captions, fontSize: captionFontSize(Number(event.target.value)) })} /></label>
            <label><span>Font weight <b>{captions.fontWeight}</b></span><input type="range" min="300" max="800" step="100" value={captions.fontWeight} onChange={(event) => setCaptions({ ...captions, fontWeight: Number(event.target.value) })} /></label>
            <label><span>Line height <b>{captions.lineHeight.toFixed(2)}</b></span><input type="range" min="1.45" max="2" step="0.05" value={captions.lineHeight} onChange={(event) => setCaptions({ ...captions, lineHeight: captionLineHeight(Number(event.target.value)) })} /></label>
            <label><span>Letter spacing <b>{captions.letterSpacing}px</b></span><input type="range" min="-2" max="8" step="0.25" value={captions.letterSpacing} onChange={(event) => setCaptions({ ...captions, letterSpacing: Number(event.target.value) })} /></label>
            <label><span>Vertical offset <b>{captionOffset}%</b></span><input type="range" min="0" max="30" value={captionOffset} onChange={(event) => setCaptions({ ...captions, [smartphoneLandscape ? "landscapeOffset" : phonePortrait ? "phonePortraitOffset" : "portraitOffset"]: captionVerticalOffset(Number(event.target.value)) })} /></label>
            <label><span>Background opacity <b>{Math.round(captions.backgroundOpacity * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value={captions.backgroundOpacity} onChange={(event) => setCaptions({ ...captions, backgroundOpacity: Number(event.target.value) })} /></label>
          </div>
          <div className="settings-actions"><Button variant="ghost" onClick={() => setCaptions(defaultCaptions)}>Reset</Button><Button variant="secondary" onClick={() => setSettings(null)}>Done</Button></div>
        </div>
      </Modal>
      <Modal open={settings === "playback"} title="Settings" onClose={() => setSettings(null)}>
        <div className="player-settings player-settings-polished">
          <div className="settings-intro"><SlidersHorizontal /><div><strong>Playback</strong><span>Picture and motion controls</span></div></div>
          <div className="settings-speed"><span>Playback speed</span><div>{[.5, .75, 1, 1.25, 1.5, 2].map((rate) => <button key={rate} className={playbackRate === rate ? "active" : ""} onClick={() => setPlaybackRate(rate)}>{rate}×</button>)}</div></div>
          <div className="settings-choice"><span>Picture fit</span><div><button className={videoFit === "contain" ? "active" : ""} onClick={() => setVideoFit("contain")}>Fit</button><button className={videoFit === "cover" ? "active" : ""} onClick={() => setVideoFit("cover")}>Fill</button></div></div>
          <label><span>Volume <b>{Math.round((videoRef.current?.volume ?? playbackPrefs.current.volume) * 100)}%</b></span><input type="range" min="0" max="1" step="0.01" defaultValue={playbackPrefs.current.volume} onChange={(event) => { if (videoRef.current) { videoRef.current.volume = Number(event.target.value); videoRef.current.muted = false; } }} /></label>
          <button className="stats-toggle" onClick={() => setStatsOpen((open) => !open)} aria-expanded={statsOpen}>Stats for nerds <span>{statsOpen ? "Hide" : "Show"}</span></button>
          {statsOpen && <div className="stats-panel">{playbackStats.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
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
