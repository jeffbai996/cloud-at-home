import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import React, { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp",
]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv"]);

export type LightboxItem = {
  name: string;
  kind: "image" | "video";
  previewUrl: string;
  fullUrl: string;
};

export function lightboxKindFor(name: string): "image" | "video" | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

export function clampLightboxIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

export function Lightbox({
  items,
  index,
  onClose,
  onNavigate,
  actions,
}: {
  items: LightboxItem[];
  index: number;
  onClose(): void;
  onNavigate(nextIndex: number): void;
  actions?: React.ReactNode;
}) {
  const item = items[clampLightboxIndex(index, items.length)];
  const step = useCallback(
    (delta: number) => onNavigate(clampLightboxIndex(index + delta, items.length)),
    [index, items.length, onNavigate],
  );

  // The key listener attaches ONCE and reads its callbacks through refs.
  // With the callbacks as effect deps, any host re-render swaps the window
  // listener — and when the HOST app also handles the same key with a state
  // update (Drive clears its selection on Escape), React flushes that update
  // synchronously mid-dispatch, the swap happens DURING the event, and per
  // the DOM spec neither the removed nor the added listener fires: the key
  // is silently swallowed. Found live: Escape closed nothing in Drive while
  // ArrowRight (no competing handler) worked.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      else if (event.key === "ArrowLeft") stepRef.current(-1);
      else if (event.key === "ArrowRight") stepRef.current(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!item) return null;
  // Portal to <body>. Rendered inline, the lightbox lives inside `.app > main`
  // (z-index 1) while the topbar is z-index 50 — so the header bar, with the
  // close/download/action buttons, was painted UNDERNEATH the topbar and
  // invisible. Portaling here rather than at each call site means no consumer
  // can get the stacking wrong (found in Photos; Drive portals already).
  return createPortal(
    <div className="lightbox" role="dialog" aria-label={item.name} onClick={onClose}>
      <header className="lightbox-bar" onClick={(event) => event.stopPropagation()}>
        <strong className="lightbox-name">{item.name}</strong>
        <div className="lightbox-actions">
          {actions}
          <a className="icon-button" href={item.fullUrl} download={item.name} aria-label="Download">
            <Download size={17} />
          </a>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="lightbox-stage" onClick={(event) => event.stopPropagation()}>
        {item.kind === "video" ? (
          <video key={item.fullUrl} src={item.fullUrl} controls autoPlay playsInline />
        ) : (
          <img key={item.previewUrl} src={item.previewUrl} alt={item.name} />
        )}
      </div>
      {items.length > 1 && (
        <>
          <button
            type="button"
            className="icon-button lightbox-nav lightbox-prev"
            aria-label="Previous"
            onClick={(event) => { event.stopPropagation(); step(-1); }}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            className="icon-button lightbox-nav lightbox-next"
            aria-label="Next"
            onClick={(event) => { event.stopPropagation(); step(1); }}
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
