interface CaptureSettings {
  language: string;
  translationEnabled: boolean;
  translationLanguage: string;
  overlayLineCount: number;
  globalShortcut: string | null;
}
interface ModelAvailability { installed: boolean; supported: boolean; deletable?: boolean; }
interface ModelLanguageState { language: string; availability: ModelAvailability; }
interface ModelSettingsResult {
  settings: CaptureSettings;
  transcription: ModelLanguageState[];
  translation: ModelLanguageState[];
  selectedTranslationLanguage: string | null;
}
type ModelSettingsAction =
  | { type: "refresh" }
  | { type: "prepare-transcription"; language: string }
  | { type: "delete-transcription"; language: string }
  | { type: "prepare-translation"; language: string };
interface ModelPreparationStatus {
  model: "transcription" | "translation"; state: "preparing" | "ready" | "error";
  percent?: number; detail: string;
}
interface CaptureStatus { state: "idle" | "connecting" | "capturing" | "error"; detail: string; }
interface CaptionRow { text: string; translation: string; kind: "draft" | "quality"; }
interface CaptionState { finals: string[]; partial: string; rows: CaptionRow[]; }
interface CaptionDebugEvent {
  source: string; action: string; text: string; detail: string;
  startMs: number; endMs: number; elapsedMs: number; latencyMs: number;
}
interface UpdaterState {
  version: string; currentVersion: string; releaseNotes: string; automaticallyDownload: boolean;
  status: "available" | "downloading" | "ready" | "error"; percent?: number; preview?: boolean; error?: string;
}
interface CaptionsBridge {
  getSettings(): Promise<CaptureSettings>; saveSettings(settings: Partial<CaptureSettings>): Promise<CaptureSettings>;
  runModelSettings(settings: CaptureSettings, action?: ModelSettingsAction): Promise<ModelSettingsResult>;
  setShortcutRecording(recording: boolean): Promise<void>; getSessionSettings(): Promise<CaptureSettings>;
  saveSessionSettings(settings: Partial<CaptureSettings>): Promise<CaptureSettings>; resetSessionSettings(): Promise<void>;
  start(settings: CaptureSettings): Promise<void>; stop(): Promise<void>; clear(): Promise<void>;
  resizeOverlay(height: number): void; showControls(): Promise<void>; showSettings(): Promise<void>;
  getUpdaterState(): Promise<UpdaterState>; installUpdate(value: boolean): Promise<void>;
  remindUpdateLater(value: boolean): Promise<void>; skipUpdate(value: boolean): Promise<void>;
  getOnboardingState(): Promise<{ settings: CaptureSettings }>;
  getTranscriptionLanguages(): Promise<string[]>;
  getTranslationLanguages(sourceLanguage?: string): Promise<string[]>;
  getTranscriptionModelAvailability(language: string): Promise<ModelAvailability>;
  getTranslationModelAvailability(source: string, target: string): Promise<ModelAvailability>;
  prepareTranscriptionModel(language: string): Promise<void>; deleteTranscriptionModel(language: string): Promise<void>;
  prepareTranslationModels(source: string, target: string): Promise<void>;
  completeOnboarding(settings: Partial<CaptureSettings>): Promise<void>;
  onOnboardingModelStatus(listener: (status: ModelPreparationStatus) => void): () => void;
  onStatus(listener: (status: CaptureStatus) => void): () => void;
  onSessionSettings(listener: (settings: CaptureSettings) => void): () => void;
  onUpdaterState(listener: (state: UpdaterState) => void): () => void;
  onCaption(listener: (state: CaptionState) => void): () => void;
  onDebug(listener: (event: CaptionDebugEvent) => void): () => void;
}
interface Window { captions: CaptionsBridge; }
