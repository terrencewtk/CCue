import { app, globalShortcut, ipcMain, Menu, screen } from "electron";
import { CaptureController } from "./capture/capture-controller";
import { normalizeCaptureSettings, readSettings, writeSettings } from "./settings/settings-store";
import type { CaptureSettings, CaptureSettingsInput } from "./shared/types";
import { ModelSettingsController, type ModelSettingsAction } from "./settings/model-settings-controller";
import { WindowManager } from "./ui/window-manager";
import { hasCompletedOnboarding, markOnboardingCompleted } from "./onboarding/onboarding-store";
import { ModelPreparationController } from "./onboarding/model-preparation-controller";
import { UpdateController } from "./updater/update-controller";
import path from "node:path";

const windows = new WindowManager();
const capture = new CaptureController(windows);
const modelPreparation = new ModelPreparationController(windows);
const updater = new UpdateController();
let sessionSettings: CaptureSettings;
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

function commitSettings(settings: CaptureSettings): void {
  const previous = sessionSettings;
  applyGlobalShortcut(settings.globalShortcut);
  try {
    writeSettings(settings);
  } catch (error) {
    try {
      applyGlobalShortcut(previous.globalShortcut);
    } catch {}
    throw error;
  }
  sessionSettings = settings;
  windows.sendSessionSettings(settings);
}

void app.whenReady().then(() => {
  onboardingCompleted = hasCompletedOnboarding();
  // A Settings commit replaces the complete session baseline. Control-window
  // edits may diverge from it until reset or restart.
  sessionSettings = readSettings();
  const modelSettings = new ModelSettingsController({
    normalize: normalizeCaptureSettings,
    read: readSettings,
    commit: commitSettings,
    transcriptionLanguages: () => languagePreview
      ? Promise.resolve(previewTranscriptionLanguages)
      : modelPreparation.transcriptionLanguages(),
    translationLanguages: (sourceLanguage) => languagePreview
      ? Promise.resolve(previewTranslationLanguages.filter(
        (language) => !sourceLanguage.toLowerCase().startsWith(language.toLowerCase())
      ))
      : modelPreparation.translationLanguages(sourceLanguage),
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
    )
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

  ipcMain.handle("settings:get", () => readSettings());
  ipcMain.handle(
    "model-settings:run",
    (_event, settings: CaptureSettingsInput, action?: ModelSettingsAction) => modelSettings.run(settings, action)
  );
  ipcMain.handle("shortcut:set-recording", (event, recording: boolean) => {
    const senderId = event.sender.id;
    if (recording === true) {
      shortcutRecordingSenders.add(senderId);
      event.sender.once("destroyed", () => { shortcutRecordingSenders.delete(senderId); });
    } else {
      shortcutRecordingSenders.delete(senderId);
    }
  });
  ipcMain.handle("onboarding:get", () => ({ settings: readSettings() }));
  ipcMain.handle("models:transcription-languages", () => (
    languagePreview ? previewTranscriptionLanguages : modelPreparation.transcriptionLanguages()
  ));
  ipcMain.handle("models:translation-languages", (_event, sourceLanguage?: string) => (
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
  ipcMain.handle("models:delete-transcription", (_event, language: string) => {
    return modelPreparation.releaseTranscription(language);
  });
  ipcMain.handle(
    "onboarding:prepare-translation",
    (_event, sourceLanguage: string, targetLanguage: string) => (
      modelPreparation.prepareTranslation(sourceLanguage, targetLanguage)
    )
  );
  ipcMain.handle("onboarding:complete", (_event, settings: CaptureSettingsInput) => {
    const completedSettings = normalizeCaptureSettings(settings);
    applyGlobalShortcut(completedSettings.globalShortcut);
    writeSettings(completedSettings);
    sessionSettings = completedSettings;
    markOnboardingCompleted();
    onboardingCompleted = true;
    windows.sendSessionSettings(completedSettings);
    windows.completeOnboarding();
    return completedSettings;
  });
  ipcMain.handle("settings:save", (_event, settings: CaptureSettingsInput) => modelSettings.saveGeneral(settings));
  ipcMain.handle("session-settings:get", () => sessionSettings);
  ipcMain.handle("session-settings:save", (_event, settings: CaptureSettingsInput) => {
    sessionSettings = normalizeCaptureSettings({ ...sessionSettings, ...settings });
    return sessionSettings;
  });
  ipcMain.handle("session-settings:reset", () => {
    sessionSettings = readSettings();
    windows.sendSessionSettings(sessionSettings);
    return sessionSettings;
  });
  ipcMain.handle("capture:start", (_event, settings: CaptureSettingsInput) => {
    return capture.start(settings);
  });
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
