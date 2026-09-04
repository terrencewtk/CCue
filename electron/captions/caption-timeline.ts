import { reconcileTurnTranscript } from "./transcript-reconciler";
import type {
  AudioTurn,
  CaptionRecord,
  CaptionState,
  DraftCaptionRecord,
  QualityCaptionRecord
} from "../shared/types";

type IdentifiedCaptionRow = CaptionState["rows"][number] & { id: string };

function draftSegmentId(draftId: number, index: number): string {
  return `draft-${draftId}-segment-${index}`;
}

function qualitySegmentId(qualityId: string, index: number): string {
  return `quality-${qualityId}-segment-${index}`;
}

export function latestQualityEnd(records: readonly CaptionRecord[]): number {
  return records.reduce(
    (latest, record) => record.type === "quality" ? Math.max(latest, record.endMs) : latest,
    0
  );
}

export function upsertDraft(
  records: CaptionRecord[],
  turn: Pick<AudioTurn, "id" | "startMs" | "endMs">,
  text: string
): DraftCaptionRecord {
  let record = records.find(
    (item): item is DraftCaptionRecord => item.id === turn.id && item.type === "draft"
  );
  if (!record) {
    record = {
      id: turn.id,
      type: "draft",
      startMs: turn.startMs,
      endMs: turn.endMs,
      text: "",
      suppressed: turn.startMs < latestQualityEnd(records)
    };
    records.push(record);
  }
  record.text = reconcileTurnTranscript(record.text, text);
  return record;
}

export function replaceDraft(
  records: CaptionRecord[],
  turn: Pick<AudioTurn, "id" | "startMs" | "endMs">,
  text: string,
  translation = "",
  preserveTranslation = false
): DraftCaptionRecord {
  let record = records.find(
    (item): item is DraftCaptionRecord => item.id === turn.id && item.type === "draft"
  );
  if (!record) {
    record = {
      id: turn.id,
      type: "draft",
      startMs: turn.startMs,
      endMs: turn.endMs,
      text: "",
      translation: "",
      suppressed: turn.startMs < latestQualityEnd(records)
    };
    records.push(record);
  }
  record.startMs = turn.startMs;
  record.endMs = turn.endMs;
  record.text = text.trim();
  if (!preserveTranslation) record.translation = translation.trim();
  // Re-evaluate suppression when real tokens for the next utterance arrive.
  record.suppressed = turn.startMs < latestQualityEnd(records);
  return record;
}

export function commitQuality(
  records: CaptionRecord[],
  quality: Omit<QualityCaptionRecord, "type" | "suppressed">
): true {
  const activeDraft = records.findLast(
    (record): record is DraftCaptionRecord => (
      record.type === "draft"
      && !record.suppressed
      && record.startMs < quality.endMs
    )
  );
  const segmentIds = segmentDraftSentences(quality.text).map((_, index) => (
    activeDraft ? draftSegmentId(activeDraft.id, index) : qualitySegmentId(quality.id, index)
  ));
  for (const record of records) {
    if (record.type === "draft" && record.startMs < quality.endMs) record.suppressed = true;
  }
  records.push({
    ...quality,
    text: quality.text.trim(),
    segmentIds,
    type: "quality",
    suppressed: false
  });
  return true;
}

export function setQualityTranslation(
  records: CaptionRecord[],
  id: string,
  translation: unknown
): boolean {
  const record = records.find(
    (item): item is QualityCaptionRecord => item.id === id && item.type === "quality"
  );
  if (!record || record.suppressed) return false;
  record.translation = String(translation || "").trim();
  return true;
}

export function segmentDraftSentences(text: unknown): string[] {
  const value = String(text || "").trim();
  if (!value) return [];

  const sentences: string[] = [];
  let sentenceStart = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "." && value[index] !== "。") continue;

    // Keep runs such as an ellipsis with the sentence they terminate.
    while (value[index + 1] === "." || value[index + 1] === "。") index += 1;
    const sentence = value.slice(sentenceStart, index + 1).trim();
    if (sentence) sentences.push(sentence);
    sentenceStart = index + 1;
  }

  const remainder = value.slice(sentenceStart).trim();
  if (remainder) sentences.push(remainder);
  return sentences;
}

function translationSegments(translation: string): string[] {
  return translation.includes("\n")
    ? translation.split(/\r?\n/u).map((sentence) => sentence.trim())
    : segmentDraftSentences(translation);
}

function segmentedRows(
  text: string,
  translation: string,
  kind: IdentifiedCaptionRow["kind"],
  idAt: (index: number) => string
): IdentifiedCaptionRow[] {
  const textSentences = segmentDraftSentences(text);
  const translationSentences = translationSegments(translation);
  const rowCount = Math.max(textSentences.length, translationSentences.length);

  return Array.from({ length: rowCount }, (_, index) => ({
    id: idAt(index),
    text: textSentences[index] || "",
    translation: translationSentences[index] || "",
    kind
  }));
}

export function renderTimeline(
  records: readonly CaptionRecord[],
  evictedRowIds?: Set<string>,
  maxRows = 3
): CaptionState {
  const qualityRows = records
    .filter((record): record is QualityCaptionRecord => (
      record.type === "quality" && Boolean(record.text.trim())
    ))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
    .flatMap((record) => segmentedRows(
      record.text,
      record.translation || "",
      "quality",
      (index) => record.segmentIds?.[index] || qualitySegmentId(record.id, index)
    ));

  const qualityEndMs = latestQualityEnd(records);
  const draftRecords = records
    .filter((record): record is DraftCaptionRecord => (
      record.type === "draft"
      && !record.suppressed
      && record.startMs >= qualityEndMs
      && Boolean(record.text.trim())
    ))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const aggregate = draftRecords.reduce(
    (value, record) => ({
      text: reconcileTurnTranscript(value.text, record.text),
      translation: reconcileTurnTranscript(value.translation, record.translation || "")
    }),
    { text: "", translation: "" }
  );
  const draftId = draftRecords.at(-1)?.id;
  const draftRows = segmentedRows(
    aggregate.text,
    aggregate.translation,
    "draft",
    (index) => draftSegmentId(draftId || 0, index)
  );
  const eligibleRows = [...qualityRows, ...draftRows]
    .filter((row) => !evictedRowIds?.has(row.id));
  const visibleRowCount = Number.isFinite(maxRows) ? Math.max(1, Math.floor(maxRows)) : 3;
  const newlyEvicted = eligibleRows.slice(0, -visibleRowCount);
  for (const row of newlyEvicted) evictedRowIds?.add(row.id);
  const rows = eligibleRows.slice(-visibleRowCount).map(({ id: _id, ...row }) => row);

  return {
    finals: rows.slice(0, -1).map((row) => row.text),
    partial: rows.at(-1)?.text || "",
    rows
  };
}
