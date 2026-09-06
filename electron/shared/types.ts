export type TranscriptionLanguage = string;
export type TranslationLanguage = string;

export interface CaptureSettingsInput {
  language?: string;
  translationEnabled?: boolean;
  translationLanguage?: string;
  overlayLineCount?: number;
  globalShortcut?: string | null;
}

export interface CaptureSettings {
  language: TranscriptionLanguage;
  translationEnabled: boolean;
  translationLanguage: TranslationLanguage;
  overlayLineCount: number;
  globalShortcut: string | null;
}

export const LANGUAGE_LIBRARY_VERSION = 2;

export interface TranslationPair {
  sourceLanguage: string;
  targetLanguage: string;
}

export interface LanguageLibrary {
  version: typeof LANGUAGE_LIBRARY_VERSION;
  enabledTranscriptionLanguages: string[];
  enabledTranslationPairs: TranslationPair[];
}

export interface SettingsSnapshot {
  settings: CaptureSettings;
  library: LanguageLibrary;
}

export interface ModelAvailability {
  installed: boolean;
  supported: boolean;
  deletable?: boolean;
}

export interface ModelLanguageState {
  language: string;
  availability: ModelAvailability;
}

export interface ModelTranslationPairState extends TranslationPair {
  availability: ModelAvailability;
}

export interface LanguageLibraryStatus {
  library: LanguageLibrary;
  transcription: ModelLanguageState[];
  translation: ModelTranslationPairState[];
}

export interface CaptionUtterance {
  text: string;
  translation: string;
  startMs: number;
  endMs: number;
}

export interface AudioChunk {
  data: string;
  durationMs: number;
  startMs: number;
  endMs: number;
}

export interface AudioTurn {
  id: number;
  chunks: AudioChunk[];
  startMs: number;
  endMs: number;
}

export interface SpeechWindow {
  startMs: number;
  endMs: number;
}

export interface DraftCaptionRecord {
  id: number;
  type: "draft";
  startMs: number;
  endMs: number;
  text: string;
  translation?: string;
  suppressed: boolean;
}

export interface QualityCaptionRecord {
  id: string;
  type: "quality";
  startMs: number;
  endMs: number;
  text: string;
  translation?: string;
  segmentIds?: string[];
  suppressed: false;
}

export type CaptionRecord = DraftCaptionRecord | QualityCaptionRecord;

export interface CaptionRow {
  text: string;
  translation: string;
  kind: CaptionRecord["type"];
}

export interface CaptionState {
  finals: string[];
  partial: string;
  rows: CaptionRow[];
}

export interface SidecarEvent {
  type: "ready" | "capture_started" | "capture_stopped" | "audio" | "error";
  sample_rate?: number;
  pcm16?: string;
  message?: string;
}

export interface LocalAsrEvent {
  type: "ready" | "languages" | "availability" | "released" | "status" | "partial" | "final" | "stopped" | "error";
  detail?: string;
  text?: string;
  start_ms?: number;
  end_ms?: number;
  message?: string;
  installed?: boolean;
  supported?: boolean;
  deletable?: boolean;
  released?: boolean;
  languages?: string[];
}

export interface LocalTranslationEvent {
  type: "ready" | "languages" | "availability" | "status" | "translation" | "error";
  detail?: string;
  request_id?: number;
  translation?: string;
  message?: string;
  installed?: boolean;
  supported?: boolean;
  languages?: string[];
}
