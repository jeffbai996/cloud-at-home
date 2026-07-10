import Hls from "hls.js";
import {
  Airplay,
  Captions,
  Expand,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { Button, Modal } from "@cloud-at-home/ui";
import { createStreamTicket, getPlaybackInfo, reportPlayback, ticketedStreamUrl, type MediaItem, type PlaybackInfo, type Session } from "./api";
import { activeCueText, resumePosition, shouldReportProgress, trickplayFrame, type TrickplayInfo } from "./playback";

type SafariVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
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
  lineHeight: number;
  letterSpacing: number;
  offset: number;
  backgroundOpacity: number;
};

const defaultCaptions: CaptionPrefs = { fontSize: 115, lineHeight: 1.25, letterSpacing: 0, offset: 8, backgroundOpacity: 0.72 };

export function Player({ item, session, onClose }: { item: MediaItem; session: Session; onClose: () => void }) {
  const shellRef = useRef<SafariFullscreenElement>(null);
  const videoRef = useRef<SafariVideo>(null);
  const hlsRef = useRef<Hls | null>(null);
  const subtitleTrackRef = useRef<HTMLTrackElement | null>(null);
  const lastReport = useRef(0);
  const [info, setInfo] = useState<PlaybackInfo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState((item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000);
  const [duration, setDuration] = useState((item.RunTimeTicks ?? 0) / 10_000_000);
  const [controls, setControls] = useState(true);
  const [settings, setSettings] = useState(false);
  const [captions, setCaptions] = useState<CaptionPrefs>(() => {
    try { return { ...defaultCaptions, ...JSON.parse(localStorage.getItem("cloud-media-captions") ?? "{}") }; }
    catch { return defaultCaptions; }
  });
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null);
  const [cue, setCue] = useState("");
  const [seekPreview, setSeekPreview] = useState<{ time: number; left: number } | null>(null);
  const [seeking, setSeeking] = useState(false);
  const [error, setError] = useState("");

  const source = info?.MediaSources?.[0];
  const subtitles = useMemo(() => source?.MediaStreams?.filter((stream) => stream.Type === "Subtitle") ?? [], [source]);
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
    PositionTicks: Math.round((videoRef.current?.currentTime ?? position) * 10_000_000),
    IsPaused: videoRef.current?.paused ?? true,
    IsMuted: videoRef.current?.muted ?? false,
    VolumeLevel: Math.round((videoRef.current?.volume ?? 1) * 100),
    PlayMethod: source?.TranscodingUrl ? "Transcode" : "DirectPlay",
    CanSeek: true,
  }), [info?.PlaySessionId, item.Id, position, source?.Id, source?.TranscodingUrl]);

  useEffect(() => {
    getPlaybackInfo(item.Id, session.user.id).then(setInfo).catch((reason) => setError(String(reason.message ?? reason)));
  }, [item.Id, session.user.id]);

  useEffect(() => {
    if (!source || !videoRef.current) return;
    const video = videoRef.current;
    let cancelled = false;
    const applyResume = () => {
      const target = resumePosition(position, video.duration);
      if (target > 0) video.currentTime = target;
    };
    void createStreamTicket(item.Id).then((ticket) => {
      if (cancelled) return;
      const direct = `Videos/${item.Id}/stream?static=true&mediaSourceId=${encodeURIComponent(source.Id)}`;
      const target = source.TranscodingUrl?.replace(/^\//, "") ?? direct;
      const url = ticketedStreamUrl(ticket, target);
      if (url.includes(".m3u8") && !video.canPlayType("application/vnd.apple.mpegurl") && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, backBufferLength: 90 });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => data.fatal && setError(data.details));
        hlsRef.current = hls;
      } else {
        video.src = url;
      }
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) applyResume();
      else video.addEventListener("loadedmetadata", applyResume, { once: true });
      void reportPlayback("start", payload()).catch(() => undefined);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not create playback session"));
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", applyResume);
      void reportPlayback("stop", payload()).catch(() => undefined);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    // Source identity is the lifecycle boundary; payload intentionally reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.Id]);

  const report = useCallback((force = false) => {
    const video = videoRef.current;
    if (!video || !info) return;
    if (force || shouldReportProgress({ previous: lastReport.current, current: video.currentTime, paused: video.paused })) {
      lastReport.current = video.currentTime;
      void reportPlayback("progress", payload()).catch(() => undefined);
    }
  }, [info, payload]);

  useEffect(() => {
    const onVisibility = () => document.hidden && report(true);
    const onPageHide = () => report(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [report]);

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
    localStorage.setItem("cloud-media-captions", JSON.stringify(captions));
  }, [captions]);

  const syncSubtitleCue = useCallback(() => {
    const active = subtitleTrackRef.current?.track.activeCues as unknown as ArrayLike<{ text: string }> | null | undefined;
    setCue(activeCueText(active ?? null));
  }, []);

  function chooseSubtitle(index: number | null) {
    setSubtitleIndex(index);
    setCue("");
    const video = videoRef.current;
    if (!video || !source) return;
    subtitleTrackRef.current = null;
    [...video.querySelectorAll("track")].forEach((node) => {
      node.track.mode = "disabled";
      node.remove();
    });
    if (index === null) return;
    const stream = subtitles.find((entry) => entry.Index === index);
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.default = true;
    track.addEventListener("load", () => {
      subtitleTrackRef.current = track;
      track.track.mode = "hidden";
      track.track.addEventListener("cuechange", syncSubtitleCue);
      syncSubtitleCue();
    }, { once: true });
    track.addEventListener("error", () => setError("Could not load that subtitle track"), { once: true });
    track.src = stream?.DeliveryUrl
      ? `/api/media/proxy/${stream.DeliveryUrl.replace(/^\//, "")}`
      : `/api/media/proxy/Videos/${item.Id}/${source.Id}/Subtitles/${index}/Stream.vtt`;
    video.appendChild(track);
    subtitleTrackRef.current = track;
    track.track.mode = "hidden";
  }

  function updateSeekPreview(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointer = event.clientX - bounds.left;
    const fraction = Math.min(1, Math.max(0, pointer / bounds.width));
    const halfPreview = Math.min(110, bounds.width / 2);
    const left = Math.max(halfPreview, Math.min(bounds.width - halfPreview, pointer));
    setSeekPreview({ time: fraction * (duration || 0), left });
  }

  function toggleFullscreen() {
    const fullscreenDocument = document as SafariFullscreenDocument;
    if (document.fullscreenElement || fullscreenDocument.webkitFullscreenElement) {
      const exit = document.exitFullscreen?.bind(document) ?? fullscreenDocument.webkitExitFullscreen?.bind(fullscreenDocument);
      const result = exit?.();
      if (result instanceof Promise) void result.catch(() => undefined);
      return;
    }
    const shell = shellRef.current;
    if (!shell) return;
    const request = shell.requestFullscreen?.bind(shell) ?? shell.webkitRequestFullscreen?.bind(shell);
    const result = request?.();
    if (result instanceof Promise) void result.catch(() => setError("Fullscreen is not available in this browser"));
  }

  return (
    <motion.div ref={shellRef} className="player-shell" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseMove={() => setControls(true)}>
      <video
        ref={videoRef}
        className="player-video"
        playsInline
        autoPlay
        x-webkit-airplay="allow"
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); report(true); }}
        onTimeUpdate={(event) => { setPosition(event.currentTarget.currentTime); syncSubtitleCue(); report(); }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
        onSeeked={() => { syncSubtitleCue(); report(true); }}
        onClick={(event) => event.currentTarget.paused ? void event.currentTarget.play() : event.currentTarget.pause()}
      />
      {cue && <div className="subtitle-layer" style={{ bottom: `${captions.offset}%`, fontSize: `clamp(${18 * captions.fontSize / 100}px, ${2.1 * captions.fontSize / 100}vw, ${48 * captions.fontSize / 100}px)`, lineHeight: captions.lineHeight, letterSpacing: `${captions.letterSpacing}px` }}><span style={{ background: `rgba(0,0,0,${captions.backgroundOpacity})` }}>{cue}</span></div>}
      <div className="player-vignette" />
      <AnimatePresence>
        {controls && (
          <motion.div className="player-controls" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseLeave={() => playing && setTimeout(() => setControls(false), 1200)}>
            <div className="player-top"><button className="player-icon" onClick={onClose}><X /></button><div><strong>{item.SeriesName ?? item.Name}</strong>{item.SeriesName && <span>{item.Name}</span>}</div></div>
            <div className="player-center">
              <button onClick={() => { if (videoRef.current) videoRef.current.currentTime -= 10; }}><RotateCcw /><span>10</span></button>
              <button className="play-main" onClick={() => videoRef.current?.paused ? void videoRef.current?.play() : videoRef.current?.pause()}>{playing ? <Pause /> : <Play />}</button>
              <button onClick={() => { if (videoRef.current) videoRef.current.currentTime += 10; }}><RotateCw /><span>10</span></button>
            </div>
            <div className="player-bottom">
              <div
                className="seek-wrap"
                onPointerEnter={updateSeekPreview}
                onPointerMove={updateSeekPreview}
                onPointerLeave={() => { if (!seeking) setSeekPreview(null); }}
                onPointerDown={(event) => { setSeeking(true); event.currentTarget.setPointerCapture(event.pointerId); }}
                onPointerUp={(event) => { setSeeking(false); setSeekPreview(null); event.currentTarget.releasePointerCapture(event.pointerId); }}
                onPointerCancel={() => { setSeeking(false); setSeekPreview(null); }}
              >
                {seekPreview && (
                  <div className="seek-preview" style={{ left: `${seekPreview.left}px` }}>
                    <SeekThumbnail item={item} sourceId={source?.Id} time={seekPreview.time} trickplay={trickplay} />
                    <strong>{formatTime(seekPreview.time)}</strong>
                  </div>
                )}
                <input className="seek" aria-label="Seek video" type="range" min={0} max={duration || 1} step="0.1" value={position} onChange={(event) => { if (videoRef.current) videoRef.current.currentTime = Number(event.target.value); }} />
              </div>
              <div className="player-row">
                <button className="player-icon" onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }}>{muted ? <VolumeX /> : <Volume2 />}</button>
                <span className="timecode">{formatTime(position)} / {formatTime(duration)}</span>
                <span className="player-spacer" />
                {subtitles.length > 0 && <button className="player-icon" aria-label="Subtitle settings" onClick={() => setSettings(true)}><Captions /></button>}
                <button className="player-icon" aria-label="AirPlay" onClick={() => videoRef.current?.webkitShowPlaybackTargetPicker?.()}><Airplay /></button>
                <button className="player-icon" aria-label="Playback settings" onClick={() => setSettings(true)}><Settings2 /></button>
                <button className="player-icon" aria-label="Enter fullscreen" onClick={toggleFullscreen}><Expand /></button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {error && <div className="player-error">{error}</div>}
      <Modal open={settings} title="Playback & subtitles" onClose={() => setSettings(false)}>
        <div className="player-settings">
          <label><span>Subtitle track</span><select value={subtitleIndex ?? ""} onChange={(event) => chooseSubtitle(event.target.value === "" ? null : Number(event.target.value))}><option value="">Off</option>{subtitles.map((stream) => <option key={stream.Index} value={stream.Index}>{stream.DisplayTitle ?? stream.Language ?? `Track ${stream.Index}`}</option>)}</select></label>
          <label><span>Text size — {captions.fontSize}%</span><input type="range" min="75" max="200" value={captions.fontSize} onChange={(event) => setCaptions({ ...captions, fontSize: Number(event.target.value) })} /></label>
          <label><span>Line height — {captions.lineHeight.toFixed(2)}</span><input type="range" min="1" max="2" step="0.05" value={captions.lineHeight} onChange={(event) => setCaptions({ ...captions, lineHeight: Number(event.target.value) })} /></label>
          <label><span>Letter spacing — {captions.letterSpacing}px</span><input type="range" min="-2" max="8" step="0.25" value={captions.letterSpacing} onChange={(event) => setCaptions({ ...captions, letterSpacing: Number(event.target.value) })} /></label>
          <label><span>Vertical offset — {captions.offset}%</span><input type="range" min="-10" max="30" value={captions.offset} onChange={(event) => setCaptions({ ...captions, offset: Number(event.target.value) })} /></label>
          <label><span>Background — {Math.round(captions.backgroundOpacity * 100)}%</span><input type="range" min="0" max="1" step="0.05" value={captions.backgroundOpacity} onChange={(event) => setCaptions({ ...captions, backgroundOpacity: Number(event.target.value) })} /></label>
          <Button variant="secondary" onClick={() => setSettings(false)}>Done</Button>
        </div>
      </Modal>
    </motion.div>
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
