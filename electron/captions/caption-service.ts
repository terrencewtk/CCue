import { commitQuality, renderTimeline, replaceDraft, setQualityTranslation } from "./caption-timeline";
import type { CaptionRecord, CaptionUtterance } from "../shared/types";
import type { WindowManager } from "../ui/window-manager";

export class CaptionService {
  private records: CaptionRecord[] = [];
  private readonly evictedRowIds = new Set<string>();
  private sequence = 0;
  private draftSequence = 1;
  private debugStartedAt = 0;
  private maxRows = 3;

  constructor(private readonly windows: WindowManager) {}

  beginSession(maxRows = 3): void {
    this.maxRows = maxRows;
    this.sequence = 0;
    this.draftSequence = 1;
    this.clear();
    this.debugStartedAt = 0;
  }

  clear(): void {
    this.records = [];
    this.evictedRowIds.clear();
    this.windows.sendCaptionState({ finals: [], partial: "", rows: [] });
  }

  markAudioTime(endMs: number): void {
    if (!this.debugStartedAt) this.debugStartedAt = Date.now() - endMs;
  }

  updateLiveCaption(
    utterance: CaptionUtterance,
    source = "apple-speech",
    preserveTranslation = false
  ): void {
    if (!utterance.text.trim() && !utterance.translation.trim()) {
      this.records = this.records.filter(
        (record) => !(record.type === "draft" && record.id === this.draftSequence)
      );
      this.render();
      return;
    }
    replaceDraft(this.records, {
      id: this.draftSequence,
      startMs: utterance.startMs,
      endMs: utterance.endMs
    }, utterance.text, utterance.translation, preserveTranslation);
    this.render();
    if (utterance.text || utterance.translation) {
      this.debug(source, "partial", utterance.text, utterance.startMs, utterance.endMs, utterance.translation);
    }
  }

  commitUtterance(
    utterance: CaptionUtterance,
    source = "apple-speech",
    preserveDraftTranslation = false
  ): string | undefined {
    if (!utterance.text.trim() && !utterance.translation.trim()) return undefined;
    const id = `${source}-${++this.sequence}`;
    const draft = this.records.find(
      (record) => record.type === "draft" && record.id === this.draftSequence
    );
    const translation = preserveDraftTranslation && !utterance.translation.trim()
      ? draft?.translation || ""
      : utterance.translation;
    commitQuality(this.records, {
      id,
      startMs: utterance.startMs,
      endMs: utterance.endMs,
      text: utterance.text,
      translation
    });
    this.draftSequence += 1;
    this.render();
    this.debug(source, "final", utterance.text, utterance.startMs, utterance.endMs, translation);
    return id;
  }

  setTranslation(id: string, translation: string): void {
    if (!setQualityTranslation(this.records, id, translation)) return;
    this.render();
  }

  private render(): void {
    this.windows.sendCaptionState(renderTimeline(this.records, this.evictedRowIds, this.maxRows));
  }

  private debug(
    source: string,
    action: string,
    text: string,
    startMs: number,
    endMs: number,
    detail = ""
  ): void {
    const elapsedMs = this.debugStartedAt ? Date.now() - this.debugStartedAt : 0;
    this.windows.sendDebug({
      source,
      action,
      text,
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      elapsedMs,
      latencyMs: Math.max(0, Math.round(elapsedMs - endMs)),
      detail
    });
  }
}
