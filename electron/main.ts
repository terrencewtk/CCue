import { app, globalShortcut, ipcMain, Menu, screen } from "electron";
import { CaptureController } from "./capture/capture-controller";
import { validateSelectedModels } from "./capture/selected-model-validator";
import {
  createOnboardingSnapshot,
  normalizeCaptureSettings,
  readSettingsSnapshot,
  writeSettingsSnapshot
} from "./settings/settings-store";
import {
  type CaptureSettings,
  type CaptureSettingsInput,
  type SettingsSnapshot
} from "./shared/types";
import {
  LanguageLibraryController,
  type LanguageLibraryAction
} from "./settings/language-library-controller";
import { WindowManager } from "./ui/window-manager";
import { hasCompletedOnboarding, markOnboardingCompleted } from "./onboarding/onboarding-store";
import { ModelPreparationController } from "./onboarding/model-preparation-controller";
import { UpdateController } from "./updater/update-controller";
import path from "node:path";

const windows = new WindowManager();
const modelPreparation = new ModelPreparationController(windows);
const capture = new CaptureController(windows, (settings) => validateSelectedModels(
  settings,
  persistedSnapshot.library,
  {
    transcription: (language) => modelPreparation.transcriptionAvailability(language),
    translation: (source, target) => modelPreparation.translationAvailability(source, target)
  }
));
const updater = new UpdateController();
let sessionSettings: CaptureSettings;
let persistedSnapshot: SettingsSnapshot;
let onboardingCompleted = false;
let registeredShortcut: string | null = null;
const shortcutRecordingSenders = new Set<number>();
const languagePreview = process.env.CCUE_LANGUAGE_PREVIEW === "1";
const previewTranscriptionLanguages = [
  "ar-SA", "zh-CN", "zh-TW", "en-AU", "en-GB", "en-US", "fr-FR", "de-DE",
  "it-IT", "ja-JP", "ko-KR", "pt-BR", "es-ES"
];
const previewTranslationLanguages = [
  "ar", "zh-Hans", "zh-Hant", "nl", "en", "fr", "de", "hi", "id", "it", "ja",
  "ko", "pl", "pt", "ru", "es", "th", "tr", "uk", "vi"
];

function toggleCaptions(): void {
  if (shortcutRecordingSenders.size) return;
  if (!onboardingCompleted) {
    windows.createOnboardingWindow();
    return;
  }
  if (capture.isCapturing) void capture.stop();
  else {
    void capture.start(sessionSettings).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      windows.sendStatus({ state: "error", detail });
    });
  }
}

function applyGlobalShortcut(shortcut: string | null): void {
  if (shortcut === registeredShortcut) return;
  const previous = registeredShortcut;
  if (previous) globalShortcut.unregister(previous);

  try {
    if (shortcut && !globalShortcut.register(shortcut, toggleCaptions)) {
      throw new Error("That shortcut is already used by macOS or another app. Try a different combination.");
    }
    registeredShortcut = shortcut;
  } catch (error) {
    registeredShortcut = null;
    if (previous && globalShortcut.register(previous, toggleCaptions)) registeredShortcut = previous;
    throw error;
  }
}

function commitSnapshot(snapshot: SettingsSnapshot, replaceSession: boolean): void {
  const previous = sessionSettings;
  applyGlobalShortcut(snapshot.settings.globalShortcut);
  try {
    writeSettingsSnapshot(snapshot);
  } catch (error) {
    try {
      applyGlobalShortcut(previous.globalShortcut);
    } catch {}
    throw error;
  }
  persistedSnapshot = snapshot;
  if (replaceSession) {
    sessionSettings = snapshot.settings;
    windows.sendSessionSettings(sessionSettings);
  }
  windows.sendLanguageLibrary(snapshot.library);
}

void app.whenReady().then(() => {
  onboardingCompleted = hasCompletedOnboarding();
  // A Settings commit replaces the complete session baseline. Control-window
  // edits may diverge from it until reset or restart.
  persistedSnapshot = readSettingsSnapshot();
  writeSettingsSnapshot(persistedSnapshot);
  sessionSettings = persistedSnapshot.settings;
  const languageLibrary = new LanguageLibraryController({
    read: () => persistedSnapshot,
    commit: (snapshot) => commitSnapshot(snapshot, false),
    transcriptionAvailability: (language) => languagePreview
      ? Promise.resolve({ installed: ["en-US", "ja-JP"].includes(language), supported: true, deletable: false })
      : modelPreparation.transcriptionAvailability(language),
    translationAvailability: (sourceLanguage, targetLanguage) => languagePreview
      ? Promise.resolve({ installed: ["en", "ja"].includes(targetLanguage), supported: true, deletable: false })
      : modelPreparation.translationAvailability(sourceLanguage, targetLanguage),
    prepareTranscription: (language) => modelPreparation.prepareTranscription(language),
    deleteTranscription: (language) => modelPreparation.releaseTranscription(language),
    prepareTranslation: (sourceLanguage, targetLanguage) => (
      modelPreparation.prepareTranslation(sourceLanguage, targetLanguage)
    ),
    modelMutationCompleted: (library) => windows.sendLanguageLibrary(library)
  });
  windows.createControlWindow(onboardingCompleted);
  windows.createOverlayWindow();
  if (!onboardingCompleted) windows.createOnboardingWindow();
  capture.ensureSidecar();
  updater.start();
  try {
    applyGlobalShortcut(sessionSettings.globalShortcut);
  } catch (error) {
    console.warn("[shortcut] Could not register configured shortcut", error);
  }

  if (!app.isPackaged) {
    app.dock?.setIcon(
      path.resolve(__dirname, "../../assets/ccue-icon-master-full.png")
    );
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        {
          label: "Settings…",
          accelerator: "CommandOrControl+,",
          click: () => onboardingCompleted ? windows.showSettings() : windows.createOnboardingWindow()
        },
        {
          label: "Check for Updates…",
          click: () => void updater.checkForUpdates()
        },
        { type: "separator" },
        { role: "hide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "windowMenu" }
  ]));

  ipcMain.handle("settings:get", () => persistedSnapshot.settings);
  ipcMain.handle("language-library:get", () => persistedSnapshot.library);
  ipcMain.handle("language-library:run", (_event, action?: LanguageLibraryAction) => languageLibrary.run(action));
  ipcMain.handle("shortcut:set-recording", (event, recording: boolean) => {
    const senderId = event.sender.id;
    if (recording === true) {
      shortcutRecordingSenders.add(senderId);
      event.sender.once("destroyed", () => { shortcutRecordingSenders.delete(senderId); });
    } else {
      shortcutRecordingSenders.delete(senderId);
    }
  });
  ipcMain.handle("onboarding:get", () => ({ settings: persistedSnapshot.settings }));
  ipcMain.handle("language-catalog:transcription", () => (
    languagePreview ? previewTranscriptionLanguages : modelPreparation.transcriptionLanguages()
  ));
  ipcMain.handle("language-catalog:translation", (_event, sourceLanguage?: string) => (
    languagePreview
      ? previewTranslationLanguages.filter((language) => !sourceLanguage?.toLowerCase().startsWith(language.toLowerCase()))
      : modelPreparation.translationLanguages(sourceLanguage)
  ));
  ipcMain.handle("onboarding:transcription-availability", (_event, language: string) => {
    return languagePreview
      ? { installed: ["en-US", "ja-JP"].includes(language), supported: true, deletable: false }
      : modelPreparation.transcriptionAvailability(language);
  });
  ipcMain.handle(
    "onboarding:translation-availability",
    (_event, sourceLanguage: string, targetLanguage: string) => (
      languagePreview
        ? { installed: ["en", "ja"].includes(targetLanguage), supported: true, deletable: false }
        : modelPreparation.translationAvailability(sourceLanguage, targetLanguage)
    )
  );
  ipcMain.handle("onboarding:prepare-transcription", (_event, language: string) => {
    return modelPreparation.prepareTranscription(language);
  });
  ipcMain.handle(
    "onboarding:prepare-translation",
    (_event, sourceLanguage: string, targetLanguage: string) => (
      modelPreparation.prepareTranslation(sourceLanguage, targetLanguage)
    )
  );
  ipcMain.handle("onboarding:complete", (_event, settings: CaptureSettingsInput) => {
    const completedSettings = normalizeCaptureSettings(settings);
    commitSnapshot(createOnboardingSnapshot(completedSettings), true);
    markOnboardingCompleted();
    onboardingCompleted = true;
    windows.completeOnboarding();
    return completedSettings;
  });
  ipcMain.handle("settings:save", (_event, settings: CaptureSettingsInput) => {
    const complete = normalizeCaptureSettings({ ...persistedSnapshot.settings, ...settings });
    commitSnapshot({ settings: complete, library: persistedSnapshot.library }, true);
    return complete;
  });
  ipcMain.handle("session-state:get", () => ({ settings: sessionSettings, library: persistedSnapshot.library }));
  ipcMain.handle("session-settings:save", (_event, settings: CaptureSettingsInput) => {
    sessionSettings = normalizeCaptureSettings({ ...sessionSettings, ...settings });
    return sessionSettings;
  });
  ipcMain.handle("capture:start", (_event, settings: CaptureSettingsInput) => capture.start(settings));
  ipcMain.handle("capture:stop", () => capture.stop());
  ipcMain.handle("caption:clear", () => capture.clearCaptions());
  ipcMain.on("overlay:resize", (event, height: unknown) => {
    windows.resizeOverlay(event.sender, height);
  });
  ipcMain.handle("controls:show", () => windows.showControls());
  ipcMain.handle("settings:show", () => windows.showSettings());
  screen.on("display-metrics-changed", () => windows.repositionOverlay());
});

app.on("activate", () => windows.activateControls());
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  capture.quit();
  modelPreparation.close();
  updater.stop();
});
