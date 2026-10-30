import { getSubtitleTiming, saveSubtitleTimingDefault, MediaRequestError } from "./api";

export type SubtitleTimingSessionDraft =
  | { kind: "nudge"; delay: number }
  | { kind: "baseline"; delay: number };

export type TimingState = {
  delay: number;
  baselineDelay: number;
  baselineRevision: number;
  hasDraft: boolean;
  sessionDraft: SubtitleTimingSessionDraft | null;
  canSaveAsDefault: boolean;
  canAdjustTiming: boolean;
  ready: boolean;
  saving: boolean;
  error: string;
};
export const emptyTiming: TimingState = {
  delay: 0, baselineDelay: 0, baselineRevision: 0,
  hasDraft: false, sessionDraft: null, canSaveAsDefault: false, canAdjustTiming: false, ready: false, saving: false, error: "",
};
export function timingLabel(delay: number): string {
  return delay === 0 ? "Original timing" : `${Math.abs(delay).toFixed(2)}s ${delay < 0 ? "earlier" : "later"}`;
}

// Nudges belong to this player session. Only the owner can deliberately turn
// the current absolute offset into the title's default for every viewer.
export class SubtitleTimingController {
  state = { ...emptyTiming };
  private readGeneration = 0;
  private sessionDraft: SubtitleTimingSessionDraft | null;
  private draftGeneration = 0;
  private disposed = false;
  constructor(
    private item: string,
    private track: string,
    private contentKey: string | null,
    private changed: (state: TimingState) => void,
    initialDraft?: SubtitleTimingSessionDraft,
    private fallbackContentKey: string | null = null,
  ) {
    this.sessionDraft = initialDraft?.kind === "nudge" && Number.isFinite(initialDraft.delay)
      ? { kind: "nudge", delay: initialDraft.delay }
      : initialDraft?.kind === "baseline" && Number.isFinite(initialDraft.delay)
        ? { kind: "baseline", delay: initialDraft.delay } : null;
    const initialDelay = this.sessionDraft?.delay ?? 0;
    this.state = {
      ...emptyTiming,
      delay: initialDelay,
      hasDraft: this.sessionDraft?.kind === "nudge",
      sessionDraft: this.currentSessionDraft(),
    };
  }
  dispose() { this.disposed = true; }
  private emit() { if (!this.disposed) this.changed({ ...this.state }); }
  private currentSessionDraft() {
    return this.sessionDraft?.kind === "nudge"
      ? { kind: "nudge", delay: this.sessionDraft.delay } as const
      : this.sessionDraft ? { kind: "baseline", delay: this.sessionDraft.delay } as const : null;
  }
  private displayedDelay(effectiveDelay: number, baselineDelay: number) {
    return this.sessionDraft?.kind === "nudge" ? this.sessionDraft.delay
      : this.sessionDraft?.kind === "baseline" ? baselineDelay : effectiveDelay;
  }
  async refresh() {
    if (this.state.saving || this.disposed) return;
    const generation = ++this.readGeneration;
    this.state.ready = false; this.emit();
    try {
      const saved = await (this.fallbackContentKey
        ? getSubtitleTiming(this.item, this.track, this.contentKey ?? undefined, this.fallbackContentKey)
        : getSubtitleTiming(this.item, this.track, this.contentKey ?? undefined));
      if (this.disposed || generation !== this.readGeneration) return;
      const baselineRevision = Number.isInteger(saved.defaultRevision) && saved.defaultRevision! >= 0 ? saved.defaultRevision! : 0;
      const baselineDelay = typeof saved.defaultDelaySeconds === "number" && Number.isFinite(saved.defaultDelaySeconds)
        ? saved.defaultDelaySeconds : 0;
      // Gateways from before published defaults only supply delaySeconds. A
      // legacy per-account value is a useful unsaved draft until a baseline
      // exists; after publication the API supplies the global effective delay.
      const legacyDelay = typeof saved.delaySeconds === "number" && Number.isFinite(saved.delaySeconds)
        ? saved.delaySeconds : baselineDelay;
      if (this.sessionDraft === null && baselineRevision === 0 && legacyDelay !== baselineDelay) {
        this.sessionDraft = { kind: "nudge", delay: legacyDelay };
      }
      if (this.sessionDraft?.kind === "baseline") {
        this.sessionDraft = { kind: "baseline", delay: baselineDelay };
      }
      const effectiveDelay = baselineRevision ? baselineDelay : legacyDelay;
      this.state = {
        delay: this.displayedDelay(effectiveDelay, baselineDelay), baselineDelay, baselineRevision,
        hasDraft: this.sessionDraft?.kind === "nudge",
        sessionDraft: this.currentSessionDraft(),
        canSaveAsDefault: this.contentKey !== null && saved.canSaveAsDefault === true,
        canAdjustTiming: saved.canAdjustTiming !== false,
        ready: true, saving: false, error: "",
      };
    } catch { if (generation !== this.readGeneration) return; this.state.error = "Could not load saved timing."; }
    this.emit();
  }
  adjust(delta: number | null) {
    if (!this.state.ready || !this.state.canAdjustTiming || this.disposed) return false;
    this.draftGeneration += 1;
    if (delta === null) {
      // Retain a baseline marker for this player session. It prevents an old
      // private value from coming back on a refresh while still following a
      // newer published baseline.
      this.sessionDraft = { kind: "baseline", delay: this.state.baselineDelay };
      this.state.delay = this.state.baselineDelay;
    } else {
      const delay = Math.max(-15, Math.min(15, Math.round((this.state.delay + delta) * 100) / 100));
      this.sessionDraft = { kind: "nudge", delay };
      this.state.delay = delay;
    }
    this.state.hasDraft = this.sessionDraft.kind === "nudge";
    this.state.sessionDraft = this.currentSessionDraft();
    this.state.error = ""; this.emit(); return true;
  }
  async saveAsDefault() {
    const contentKey = this.contentKey;
    if (this.state.saving || !this.state.ready || !this.state.canSaveAsDefault || contentKey === null) return;
    this.state.saving = true; this.emit();
    const delay = this.state.delay;
    const draftGeneration = this.draftGeneration;
    try {
      const saved = await saveSubtitleTimingDefault(this.item, this.track, {
        delaySeconds: delay, revision: this.state.baselineRevision, contentKey,
      });
      if (this.disposed) return;
      this.state.baselineDelay = saved.delaySeconds;
      this.state.baselineRevision = saved.revision;
      if (this.draftGeneration === draftGeneration) {
        // The acknowledged snapshot is now the published baseline; it no
        // longer needs a local draft entry.
        this.sessionDraft = null;
      }
      if (this.sessionDraft?.kind === "baseline") {
        this.sessionDraft = { kind: "baseline", delay: saved.delaySeconds };
      }
      // A newer nudge, or a Reset clicked while the request was in flight,
      // belongs to this player session rather than the request snapshot.
      this.state.delay = this.displayedDelay(saved.delaySeconds, saved.delaySeconds);
      this.state.hasDraft = this.sessionDraft?.kind === "nudge";
      this.state.sessionDraft = this.currentSessionDraft();
      this.state.saving = false;
      this.state.error = "";
    } catch (error) {
      this.state.saving = false;
      if (error instanceof MediaRequestError && error.status === 409) {
        await this.refresh();
        if (this.state.ready) this.state.error = "Timing default changed on another device. Published default loaded.";
      } else this.state.error = "Could not save the default. This adjustment is only active here.";
    }
    this.emit();
  }
}
