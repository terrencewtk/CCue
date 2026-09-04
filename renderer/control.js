const captureButton = document.querySelector("#captureButton");
const settingsButton = document.querySelector("#settingsButton");
const statusMessage = document.querySelector("#statusMessage");
const sessionLanguage = document.querySelector("#sessionLanguage");
const sessionTranslationEnabled = document.querySelector("#sessionTranslationEnabled");
const sessionTranslationLanguage = document.querySelector("#sessionTranslationLanguage");
const {
  TRANSCRIPTION_LANGUAGES,
  TRANSLATION_LANGUAGES,
  createModelChecker,
  isReady
} = window.modelAvailability;
const modelChecker = createModelChecker(window.captions);

let capturing = false;
let captureState = "idle";
let sessionSettingsLoaded = false;
let translationModelsAvailable = false;
let availabilityRefresh;
let availabilityGeneration = 0;

function placeholderOption(select, label) {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  option.disabled = true;
  option.selected = true;
  select.replaceChildren(option);
}

function populateReadyOptions(select, models, readyValues, preferredValue) {
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
  const selectedValue = readyValues.has(preferredValue) ? preferredValue : readyModels[0].value;
  select.value = selectedValue;
  return selectedValue;
}

async function confirmedReady(check) {
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

async function readyTranscriptionLanguages() {
  const ready = new Set();
  for (const model of TRANSCRIPTION_LANGUAGES) {
    if (await confirmedReady(() => modelChecker.transcription(model.value))) ready.add(model.value);
  }
  return ready;
}

async function readyTranslationLanguages(sourceLanguage) {
  const ready = new Set();
  for (const model of TRANSLATION_LANGUAGES) {
    if (model.value === sourceLanguage) continue;
    if (await confirmedReady(() => modelChecker.translation(sourceLanguage, model.value))) {
      ready.add(model.value);
    }
  }
  return ready;
}

async function refreshTranslationOptions(sourceLanguage, preferredTarget, generation) {
  placeholderOption(sessionTranslationLanguage, "Checking downloaded models…");
  translationModelsAvailable = false;
  updateSessionControls();
  const ready = await readyTranslationLanguages(sourceLanguage);
  if (generation !== availabilityGeneration) return;
  const selected = populateReadyOptions(
    sessionTranslationLanguage,
    TRANSLATION_LANGUAGES,
    ready,
    preferredTarget
  );
  translationModelsAvailable = Boolean(selected);
  if (!translationModelsAvailable) sessionTranslationEnabled.checked = false;
}

async function refreshReadyModels(settings) {
  if (availabilityRefresh) return availabilityRefresh;
  const generation = ++availabilityGeneration;
  sessionSettingsLoaded = false;
  placeholderOption(sessionLanguage, "Checking downloaded models…");
  placeholderOption(sessionTranslationLanguage, "Checking downloaded models…");
  updateSessionControls();

  availabilityRefresh = (async () => {
    const readyTranscription = await readyTranscriptionLanguages();
    if (generation !== availabilityGeneration) return;
    const selectedLanguage = populateReadyOptions(
      sessionLanguage,
      TRANSCRIPTION_LANGUAGES,
      readyTranscription,
      settings.language || "ja-JP"
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

function currentSessionSettings() {
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

async function renderSessionSettings(settings) {
  await refreshReadyModels(settings);
}

async function persistSessionSettings() {
  try {
    await window.captions.saveSessionSettings(currentSessionSettings());
  } catch (error) {
    renderStatus({ state: "error", detail: `Could not update session settings: ${error.message}` });
  }
}

function renderStatus({ state, detail }) {
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
    renderStatus({ state: "error", detail: error.message });
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

window.captions.getSessionSettings().then(renderSessionSettings).catch((error) => {
  renderStatus({ state: "error", detail: `Could not load session settings: ${error.message}` });
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
