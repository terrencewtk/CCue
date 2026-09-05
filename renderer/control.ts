import {
  createModelChecker,
  isReady
} from "./model-availability.js";
import {
  LEGACY_TRANSCRIPTION_LANGUAGES,
  LEGACY_TRANSLATION_LANGUAGES,
  languageModels,
  resolveLanguageSelection,
  sameTranslationLanguage,
  type LanguageModel
} from "./language-catalog.js";

const captureButton = document.querySelector<HTMLButtonElement>("#captureButton")!;
const settingsButton = document.querySelector<HTMLButtonElement>("#settingsButton")!;
const statusMessage = document.querySelector<HTMLElement>("#statusMessage")!;
const sessionLanguage = document.querySelector<HTMLSelectElement>("#sessionLanguage")!;
const sessionTranslationEnabled = document.querySelector<HTMLInputElement>("#sessionTranslationEnabled")!;
const sessionTranslationLanguage = document.querySelector<HTMLSelectElement>("#sessionTranslationLanguage")!;
const modelChecker = createModelChecker(window.captions);

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let capturing = false;
let captureState: CaptureStatus["state"] = "idle";
let sessionSettingsLoaded = false;
let translationModelsAvailable = false;
let availabilityRefresh: Promise<void> | undefined;
let availabilityGeneration = 0;
let transcriptionLanguages: LanguageModel[] = [];
let translationLanguages: LanguageModel[] = [];

function placeholderOption(select: HTMLSelectElement, label: string): void {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  option.disabled = true;
  option.selected = true;
  select.replaceChildren(option);
}

function populateReadyOptions(select: HTMLSelectElement, models: LanguageModel[], readyValues: Set<string>, preferredValue: string): string {
  const readyModels = models.filter((model) => readyValues.has(model.value));
  if (!readyModels.length) {
    placeholderOption(select, "No downloaded models");
    return "";
  }
  select.replaceChildren(...readyModels.map((model) => {
    const option = document.createElement("option");
    option.value = model.value;
    option.textContent = model.name;
    return option;
  }));
  const selectedValue = readyValues.has(preferredValue) ? preferredValue : readyModels[0]!.value;
  select.value = selectedValue;
  return selectedValue;
}

async function confirmedReady(check: () => Promise<ModelAvailability>): Promise<boolean> {
  try {
    return isReady(await check());
  } catch {
    try {
      return isReady(await check());
    } catch {
      return false;
    }
  }
}

async function readyTranscriptionLanguages(): Promise<Set<string>> {
  const ready = new Set<string>();
  for (const model of transcriptionLanguages) {
    if (await confirmedReady(() => modelChecker.transcription(model.value))) ready.add(model.value);
  }
  return ready;
}

async function readyTranslationLanguages(sourceLanguage: string): Promise<Set<string>> {
  const ready = new Set<string>();
  for (const model of translationLanguages) {
    if (sameTranslationLanguage(model.value, sourceLanguage)) continue;
    if (await confirmedReady(() => modelChecker.translation(sourceLanguage, model.value))) {
      ready.add(model.value);
    }
  }
  return ready;
}

async function refreshTranslationOptions(sourceLanguage: string, preferredTarget: string, generation: number): Promise<void> {
  placeholderOption(sessionTranslationLanguage, "Checking downloaded models…");
  translationModelsAvailable = false;
  updateSessionControls();
  let identifiers: string[];
  try {
    identifiers = await window.captions.getTranslationLanguages(sourceLanguage);
  } catch {
    identifiers = LEGACY_TRANSLATION_LANGUAGES.filter((target) => !sameTranslationLanguage(target, sourceLanguage));
  }
  translationLanguages = languageModels(identifiers);
  const ready = await readyTranslationLanguages(sourceLanguage);
  if (generation !== availabilityGeneration) return;
  const selected = populateReadyOptions(
    sessionTranslationLanguage,
    translationLanguages,
    ready,
    resolveLanguageSelection(preferredTarget, identifiers, "en-US")
  );
  translationModelsAvailable = Boolean(selected);
  if (!translationModelsAvailable) sessionTranslationEnabled.checked = false;
}

async function refreshReadyModels(settings: CaptureSettings): Promise<void> {
  if (availabilityRefresh) return availabilityRefresh;
  const generation = ++availabilityGeneration;
  sessionSettingsLoaded = false;
  placeholderOption(sessionLanguage, "Checking downloaded models…");
  placeholderOption(sessionTranslationLanguage, "Checking downloaded models…");
  updateSessionControls();

  availabilityRefresh = (async () => {
    let transcriptionIdentifiers: string[];
    try {
      transcriptionIdentifiers = await window.captions.getTranscriptionLanguages();
    } catch {
      transcriptionIdentifiers = [...LEGACY_TRANSCRIPTION_LANGUAGES];
    }
    transcriptionLanguages = languageModels(transcriptionIdentifiers);
    const readyTranscription = await readyTranscriptionLanguages();
    if (generation !== availabilityGeneration) return;
    const selectedLanguage = populateReadyOptions(
      sessionLanguage,
      transcriptionLanguages,
      readyTranscription,
      resolveLanguageSelection(settings.language || "ja-JP", transcriptionIdentifiers, "en-US")
    );
    sessionTranslationEnabled.checked = settings.translationEnabled !== false;
    if (selectedLanguage) {
      await refreshTranslationOptions(
        selectedLanguage,
        settings.translationLanguage || "en-US",
        generation
      );
    } else {
      placeholderOption(sessionTranslationLanguage, "No downloaded models");
      translationModelsAvailable = false;
      sessionTranslationEnabled.checked = false;
    }
    if (generation !== availabilityGeneration) return;
    sessionSettingsLoaded = Boolean(selectedLanguage);
    if (!selectedLanguage) {
      renderStatus({
        state: "error",
        detail: "No downloaded transcription models are ready. Download one in Settings."
      });
    } else {
      updateSessionControls();
    }
  })().finally(() => {
    availabilityRefresh = undefined;
  });
  return availabilityRefresh;
}

placeholderOption(sessionLanguage, "Checking downloaded models…");
placeholderOption(sessionTranslationLanguage, "Checking downloaded models…");

function currentSessionSettings(): Partial<CaptureSettings> {
  return {
    language: sessionLanguage.value,
    translationEnabled: sessionTranslationEnabled.checked,
    translationLanguage: sessionTranslationLanguage.value
  };
}

function updateSessionControls() {
  sessionLanguage.disabled = capturing || !sessionSettingsLoaded;
  sessionTranslationEnabled.disabled = capturing || !sessionSettingsLoaded || !translationModelsAvailable;
  sessionTranslationLanguage.disabled = capturing
    || !sessionSettingsLoaded
    || !translationModelsAvailable
    || !sessionTranslationEnabled.checked;
  captureButton.disabled = captureState === "connecting" || !sessionSettingsLoaded;
}

async function renderSessionSettings(settings: CaptureSettings): Promise<void> {
  await refreshReadyModels(settings);
}

async function persistSessionSettings() {
  try {
    await window.captions.saveSessionSettings(currentSessionSettings());
  } catch (error) {
    renderStatus({ state: "error", detail: `Could not update session settings: ${messageFrom(error)}` });
  }
}

function renderStatus({ state, detail }: CaptureStatus): void {
  captureState = state;
  capturing = state === "capturing" || state === "connecting";
  const label = {
    idle: "Ready",
    connecting: "Connecting",
    capturing: "Capturing system audio",
    error: "Needs attention"
  }[state] || "Ready";
  statusMessage.textContent = `${label}. ${detail || "Waiting to start"}`;
  captureButton.title = state === "error" && detail ? detail : "";
  captureButton.textContent = capturing ? "Stop captions" : "Start captions";
  captureButton.classList.toggle("stop", capturing);
  updateSessionControls();
}

if (!window.captions) {
  renderStatus({
    state: "error",
    detail: "Electron preload bridge is unavailable. Restart the app or reinstall this build."
  });
  throw new Error("Electron preload bridge is unavailable");
}

captureButton.addEventListener("click", async () => {
  captureButton.disabled = true;
  try {
    if (capturing) await window.captions.stop();
    else {
      const activeSettings = await window.captions.saveSessionSettings(currentSessionSettings());
      await window.captions.start(activeSettings);
    }
  } catch (error) {
    renderStatus({ state: "error", detail: messageFrom(error) });
  } finally {
    captureButton.disabled = false;
  }
});

settingsButton.addEventListener("click", () => window.captions.showSettings());
sessionLanguage.addEventListener("change", async () => {
  const generation = ++availabilityGeneration;
  sessionSettingsLoaded = false;
  await refreshTranslationOptions(
    sessionLanguage.value,
    sessionTranslationLanguage.value,
    generation
  );
  if (generation !== availabilityGeneration) return;
  sessionSettingsLoaded = true;
  updateSessionControls();
  await persistSessionSettings();
});
sessionTranslationEnabled.addEventListener("change", () => {
  updateSessionControls();
  persistSessionSettings();
});
sessionTranslationLanguage.addEventListener("change", persistSessionSettings);

window.captions.getSessionSettings().then(renderSessionSettings).catch((error: unknown) => {
  renderStatus({ state: "error", detail: `Could not load session settings: ${messageFrom(error)}` });
});
window.captions.onSessionSettings((settings) => {
  void refreshReadyModels(settings);
});
window.addEventListener("focus", () => {
  if (!capturing) {
    window.captions.getSessionSettings().then(refreshReadyModels).catch(() => {});
  }
});

window.captions.onStatus(renderStatus);
window.captions.onDebug((event) => {
  const elapsed = (event.elapsedMs / 1_000).toFixed(2);
  const latency = (event.latencyMs / 1_000).toFixed(2);
  console.info(
    `[caption:${event.source}] ${event.action} at ${elapsed}s, latency ${latency}s, audio ${event.startMs}-${event.endMs}ms`,
    event.text,
    event.detail || ""
  );
});
