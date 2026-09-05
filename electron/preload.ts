import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type Listener<T> = (payload: T) => void;

function subscribe<T>(channel: string, listener: Listener<T>): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("captions", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  runModelSettings: (settings: unknown, action?: unknown) => (
    ipcRenderer.invoke("model-settings:run", settings, action)
  ),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("settings:save", settings),
  setShortcutRecording: (recording: boolean) => ipcRenderer.invoke("shortcut:set-recording", recording),
  getSessionSettings: () => ipcRenderer.invoke("session-settings:get"),
  saveSessionSettings: (settings: unknown) => ipcRenderer.invoke("session-settings:save", settings),
  resetSessionSettings: () => ipcRenderer.invoke("session-settings:reset"),
  start: (settings: unknown) => ipcRenderer.invoke("capture:start", settings),
  stop: () => ipcRenderer.invoke("capture:stop"),
  clear: () => ipcRenderer.invoke("caption:clear"),
  resizeOverlay: (height: number) => ipcRenderer.send("overlay:resize", height),
  showControls: () => ipcRenderer.invoke("controls:show"),
  showSettings: () => ipcRenderer.invoke("settings:show"),
  getUpdaterState: () => ipcRenderer.invoke("updater:get-state"),
  installUpdate: (automaticallyDownload: boolean) => ipcRenderer.invoke("updater:install", automaticallyDownload),
  remindUpdateLater: (automaticallyDownload: boolean) => ipcRenderer.invoke("updater:remind-later", automaticallyDownload),
  skipUpdate: (automaticallyDownload: boolean) => ipcRenderer.invoke("updater:skip", automaticallyDownload),
  getOnboardingState: () => ipcRenderer.invoke("onboarding:get"),
  getTranscriptionLanguages: () => ipcRenderer.invoke("models:transcription-languages"),
  getTranslationLanguages: (sourceLanguage?: string) => (
    ipcRenderer.invoke("models:translation-languages", sourceLanguage)
  ),
  getTranscriptionModelAvailability: (language: string) => (
    ipcRenderer.invoke("onboarding:transcription-availability", language)
  ),
  getTranslationModelAvailability: (sourceLanguage: string, targetLanguage: string) => (
    ipcRenderer.invoke("onboarding:translation-availability", sourceLanguage, targetLanguage)
  ),
  prepareTranscriptionModel: (language: string) => ipcRenderer.invoke("onboarding:prepare-transcription", language),
  deleteTranscriptionModel: (language: string) => ipcRenderer.invoke("models:delete-transcription", language),
  prepareTranslationModels: (sourceLanguage: string, targetLanguage: string) => (
    ipcRenderer.invoke("onboarding:prepare-translation", sourceLanguage, targetLanguage)
  ),
  completeOnboarding: (settings: unknown) => ipcRenderer.invoke("onboarding:complete", settings),
  onOnboardingModelStatus: (listener: Listener<unknown>) => subscribe("onboarding:model-status", listener),
  onStatus: (listener: Listener<unknown>) => subscribe("capture:status", listener),
  onSessionSettings: (listener: Listener<unknown>) => subscribe("session-settings:update", listener),
  onUpdaterState: (listener: Listener<unknown>) => subscribe("updater:state", listener),
  onCaption: (listener: Listener<unknown>) => subscribe("caption:update", listener),
  onDebug: (listener: Listener<unknown>) => subscribe("caption:debug", listener)
});
