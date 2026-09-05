import { DEFAULT_SHORTCUT, acceleratorFromEvent, display } from "./shortcut.js";
import {
  LEGACY_TRANSCRIPTION_LANGUAGES,
  LEGACY_TRANSLATION_LANGUAGES,
  languageModels,
  resolveLanguageSelection,
  sameTranslationLanguage
} from "./language-catalog.js";
import { LanguagePicker } from "./language-picker.js";

const steps = [...document.querySelectorAll<HTMLElement>(".step")];
const dots = [...document.querySelectorAll<HTMLElement>(".step-dot")];
const backButton = document.querySelector<HTMLButtonElement>("#backButton")!;
const nextButton = document.querySelector<HTMLButtonElement>("#nextButton")!;
const errorMessage = document.querySelector<HTMLElement>("#onboardingError")!;
const language = new LanguagePicker(document.querySelector<HTMLElement>("#onboardingLanguage")!, "spoken languages");
const translationLanguage = new LanguagePicker(document.querySelector<HTMLElement>("#onboardingTranslationLanguage")!, "translation languages");
const downloadTranscription = document.querySelector<HTMLButtonElement>("#downloadTranscription")!;
const transcriptionCard = document.querySelector<HTMLElement>("#transcriptionCard")!;
const transcriptionStatus = document.querySelector<HTMLElement>("#transcriptionStatus")!;
const transcriptionPercent = document.querySelector<HTMLElement>("#transcriptionPercent")!;
const transcriptionProgressTrack = document.querySelector<HTMLElement>("#transcriptionProgress")!;
const transcriptionProgress = document.querySelector<HTMLElement>("#transcriptionProgress span")!;
const downloadTranslation = document.querySelector<HTMLButtonElement>("#downloadTranslation")!;
const translationCard = document.querySelector<HTMLElement>("#translationCard")!;
const translationStatus = document.querySelector<HTMLElement>("#translationStatus")!;
const translationProgress = document.querySelector<HTMLElement>("#translationProgress")!;
const translationSetup = document.querySelector<HTMLElement>("#translationSetup")!;
const translationChoices = [...document.querySelectorAll<HTMLInputElement>('input[name="useTranslation"]')];
const shortcutRecorder = document.querySelector<HTMLButtonElement>("#onboardingShortcutRecorder")!;
const shortcutRemove = document.querySelector<HTMLButtonElement>("#onboardingShortcutRemove")!;

let currentStep = 0;
let transcriptionReadyFor = "";
let translationReadyFor = "";
let preparing = false;
let selectedShortcut: string | null = DEFAULT_SHORTCUT;
let recordingShortcut = false;

function translationEnabled(): boolean {
  return document.querySelector<HTMLInputElement>('input[name="useTranslation"]:checked')!.value === "yes";
}

function translationKey() {
  return `${language.value}->${translationLanguage.value}`;
}

function clearError() {
  errorMessage.textContent = "";
  errorMessage.classList.add("hidden");
}

function showError(error: unknown): void {
  errorMessage.textContent = error instanceof Error ? error.message : String(error);
  errorMessage.classList.remove("hidden");
}

function renderStep() {
  steps.forEach((step, index) => step.classList.toggle("active", index === currentStep));
  dots.forEach((dot, index) => {
    dot.classList.toggle("active", index === currentStep);
    dot.classList.toggle("complete", index < currentStep);
  });
  backButton.classList.toggle("hidden", currentStep === 0 || currentStep === 4);
  nextButton.textContent = ["Get started", "Continue", "Continue", "Continue", "Start using CCue"][currentStep] ?? "Continue";
  clearError();
  updateActions();
}

function renderShortcut() {
  shortcutRecorder.textContent = recordingShortcut
    ? "Press shortcut…"
    : display(selectedShortcut);
  shortcutRecorder.classList.toggle("recording", recordingShortcut);
  shortcutRecorder.setAttribute("aria-pressed", String(recordingShortcut));
  shortcutRemove.textContent = selectedShortcut ? "Disable keyboard shortcut" : "Use default shortcut";
}

function stopShortcutRecording() {
  recordingShortcut = false;
  void window.captions?.setShortcutRecording(false);
  renderShortcut();
}

function updateActions() {
  const transcriptionComplete = transcriptionReadyFor === language.value;
  const translationComplete = !translationEnabled() || translationReadyFor === translationKey();
  nextButton.disabled = preparing
    || (currentStep === 1 && !transcriptionComplete)
    || (currentStep === 2 && !translationComplete);
  backButton.disabled = preparing;
}

function showTranscriptionChecking() {
  transcriptionReadyFor = "";
  transcriptionCard.classList.remove("ready", "error");
  transcriptionStatus.textContent = "Checking model status…";
  transcriptionPercent.textContent = "";
  transcriptionProgress.style.width = "0%";
  transcriptionProgressTrack.classList.add("hidden");
  downloadTranscription.classList.add("hidden");
  updateActions();
}

function showTranslationChecking() {
  translationReadyFor = "";
  translationCard.classList.remove("ready", "error");
  translationStatus.textContent = "Checking model status…";
  translationProgress.classList.add("hidden");
  downloadTranslation.classList.add("hidden");
  updateActions();
}

function renderTranscriptionAvailability(installed: boolean): void {
  transcriptionCard.classList.toggle("ready", installed);
  transcriptionCard.classList.remove("error");
  transcriptionProgressTrack.classList.add("hidden");
  transcriptionPercent.textContent = "";
  if (installed) {
    transcriptionReadyFor = language.value;
    transcriptionStatus.textContent = "Ready to go";
    downloadTranscription.classList.add("hidden");
  } else {
    transcriptionReadyFor = "";
    transcriptionStatus.textContent = "Not downloaded — click Download to install.";
    downloadTranscription.textContent = "Download";
    downloadTranscription.classList.remove("hidden");
  }
  updateActions();
}

function renderTranslationAvailability(installed: boolean): void {
  translationCard.classList.toggle("ready", installed);
  translationCard.classList.remove("error");
  translationProgress.classList.add("hidden");
  if (installed) {
    translationReadyFor = translationKey();
    translationStatus.textContent = "Ready to go";
    downloadTranslation.classList.add("hidden");
  } else {
    translationReadyFor = "";
    translationStatus.textContent = "Not downloaded — click Download to install.";
    downloadTranslation.textContent = "Download";
    downloadTranslation.classList.remove("hidden");
  }
  updateActions();
}

async function refreshTranscriptionAvailability() {
  showTranscriptionChecking();
  setPreparing(true);
  try {
    const checkedLanguage = language.value;
    const { installed, supported } = await window.captions.getTranscriptionModelAvailability(checkedLanguage);
    if (!supported) throw new Error("This transcription language is not supported on this Mac");
    if (language.value === checkedLanguage) renderTranscriptionAvailability(installed);
  } catch (error) {
    transcriptionCard.classList.add("error");
    transcriptionStatus.textContent = error instanceof Error ? error.message : String(error);
    downloadTranscription.textContent = "Try again";
    downloadTranscription.classList.remove("hidden");
  } finally {
    setPreparing(false);
  }
}

async function refreshTranslationAvailability() {
  if (!translationEnabled()) return;
  if (!translationLanguage.value) {
    translationCard.classList.add("error");
    translationStatus.textContent = "Apple reported no translation targets for this spoken language.";
    downloadTranslation.classList.add("hidden");
    translationProgress.classList.add("hidden");
    updateActions();
    return;
  }
  showTranslationChecking();
  setPreparing(true);
  try {
    const checkedPair = translationKey();
    const { installed, supported } = await window.captions.getTranslationModelAvailability(
      language.value,
      translationLanguage.value
    );
    if (!supported) throw new Error("This translation language pair is not supported on this Mac");
    if (translationKey() === checkedPair) renderTranslationAvailability(installed);
  } catch (error) {
    translationCard.classList.add("error");
    translationStatus.textContent = error instanceof Error ? error.message : String(error);
    downloadTranslation.textContent = "Try again";
    downloadTranslation.classList.remove("hidden");
  } finally {
    setPreparing(false);
  }
}

async function updateTargetOptions(preferred = translationLanguage.value || "en-US") {
  translationLanguage.setMessage("Loading languages…");
  try {
    const targets = await window.captions.getTranslationLanguages(language.value);
    const selectable = targets.filter((target) => !sameTranslationLanguage(target, language.value));
    if (!selectable.length) {
      translationLanguage.setMessage("No translation targets");
      showError("Apple reported no translation targets for this spoken language.");
      return;
    }
    const selected = resolveLanguageSelection(preferred, selectable, "en-US");
    translationLanguage.setOptions(languageModels(selectable), selected);
  } catch (error) {
    const fallbackTargets = LEGACY_TRANSLATION_LANGUAGES.filter((target) => !sameTranslationLanguage(target, language.value));
    if (!fallbackTargets.length) {
      translationLanguage.setMessage("No translation targets");
      showError(`Could not refresh Apple translation languages: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    translationLanguage.setOptions(languageModels(fallbackTargets), resolveLanguageSelection(preferred, fallbackTargets, "en-US"));
    showError(`Could not refresh Apple translation languages: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function updateTranslationChoice() {
  translationChoices.forEach((choice) => {
    choice.closest<HTMLElement>(".choice-card")!.classList.toggle("selected", choice.checked);
  });
  translationSetup.classList.toggle("hidden", !translationEnabled());
  translationLanguage.setDisabled(preparing || !translationEnabled());
  updateActions();
}

function setPreparing(value: boolean): void {
  preparing = value;
  downloadTranscription.disabled = value;
  downloadTranslation.disabled = value;
  language.setDisabled(value);
  translationLanguage.setDisabled(value || !translationEnabled());
  translationChoices.forEach((choice) => { choice.disabled = value; });
  shortcutRecorder.disabled = value;
  shortcutRemove.disabled = value;
  updateActions();
}

downloadTranscription.addEventListener("click", async () => {
  clearError();
  setPreparing(true);
  transcriptionCard.classList.remove("ready", "error");
  transcriptionStatus.textContent = "Preparing download…";
  downloadTranscription.classList.add("hidden");
  transcriptionProgressTrack.classList.remove("hidden");
  try {
    await window.captions.prepareTranscriptionModel(language.value);
    renderTranscriptionAvailability(true);
  } catch (error) {
    transcriptionCard.classList.add("error");
    transcriptionProgressTrack.classList.add("hidden");
    downloadTranscription.textContent = "Try again";
    downloadTranscription.classList.remove("hidden");
    showError(error);
  } finally {
    setPreparing(false);
  }
});

downloadTranslation.addEventListener("click", async () => {
  clearError();
  setPreparing(true);
  translationCard.classList.remove("ready", "error");
  translationStatus.textContent = "Preparing download…";
  downloadTranslation.classList.add("hidden");
  translationProgress.classList.remove("hidden");
  try {
    await window.captions.prepareTranslationModels(language.value, translationLanguage.value);
    renderTranslationAvailability(true);
  } catch (error) {
    translationCard.classList.add("error");
    translationProgress.classList.add("hidden");
    downloadTranslation.textContent = "Try again";
    downloadTranslation.classList.remove("hidden");
    showError(error);
  } finally {
    setPreparing(false);
  }
});

language.onChange(async () => {
  await updateTargetOptions();
  await refreshTranscriptionAvailability();
  await refreshTranslationAvailability();
});
translationLanguage.onChange(() => { void refreshTranslationAvailability(); });
translationChoices.forEach((choice) => choice.addEventListener("change", async () => {
  updateTranslationChoice();
  await refreshTranslationAvailability();
}));

backButton.addEventListener("click", () => {
  stopShortcutRecording();
  if (currentStep > 0) currentStep -= 1;
  renderStep();
});

nextButton.addEventListener("click", async () => {
  if (currentStep < 4) {
    stopShortcutRecording();
    currentStep += 1;
    renderStep();
    return;
  }
  setPreparing(true);
  try {
    await window.captions.completeOnboarding({
      language: language.value,
      translationEnabled: translationEnabled(),
      translationLanguage: translationLanguage.value,
      globalShortcut: selectedShortcut
    });
  } catch (error) {
    showError(error);
    setPreparing(false);
  }
});

shortcutRecorder.addEventListener("click", () => {
  recordingShortcut = true;
  void window.captions.setShortcutRecording(true);
  clearError();
  renderShortcut();
});

shortcutRemove.addEventListener("click", () => {
  selectedShortcut = selectedShortcut ? null : DEFAULT_SHORTCUT;
  stopShortcutRecording();
  clearError();
});

document.addEventListener("keydown", (event) => {
  if (!recordingShortcut) return;
  event.preventDefault();
  event.stopPropagation();
  const result = acceleratorFromEvent(event);
  if (result.pending) return;
  if (result.cancelled) {
    stopShortcutRecording();
    return;
  }
  if (result.error) {
    showError(result.error);
    return;
  }
  selectedShortcut = result.accelerator ?? null;
  stopShortcutRecording();
  clearError();
}, true);

window.addEventListener("beforeunload", () => {
  void window.captions?.setShortcutRecording(false);
});

function handleModelStatus(status: ModelPreparationStatus): void {
  if (status.model === "transcription") {
    transcriptionStatus.textContent = status.detail;
    if (typeof status.percent === "number") {
      transcriptionPercent.textContent = `${status.percent}%`;
      transcriptionProgress.style.width = `${status.percent}%`;
      transcriptionProgressTrack.classList.remove("hidden");
    }
    if (status.state === "ready") {
      transcriptionCard.classList.add("ready");
      transcriptionStatus.textContent = "Ready to go";
      transcriptionProgressTrack.classList.add("hidden");
      downloadTranscription.classList.add("hidden");
    } else if (status.state === "error") {
      transcriptionCard.classList.add("error");
      downloadTranscription.textContent = "Try again";
      downloadTranscription.classList.remove("hidden");
    }
  } else {
    translationStatus.textContent = status.detail;
    translationProgress.classList.toggle("hidden", status.state !== "preparing");
    if (status.state === "ready") {
      translationCard.classList.add("ready");
      translationStatus.textContent = "Ready to go";
      downloadTranslation.classList.add("hidden");
    } else if (status.state === "error") {
      translationCard.classList.add("error");
      downloadTranslation.textContent = "Try again";
      downloadTranslation.classList.remove("hidden");
    }
  }
}

if (!window.captions) {
  showError("The CCue setup bridge is unavailable. Restart or reinstall the app.");
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select").forEach((control) => { control.disabled = true; });
} else {
  window.captions.onOnboardingModelStatus(handleModelStatus);
  window.captions.getOnboardingState().then(async ({ settings }) => {
    let transcription: string[];
    try {
      transcription = await window.captions.getTranscriptionLanguages();
    } catch (error) {
      transcription = [...LEGACY_TRANSCRIPTION_LANGUAGES];
      showError(`Could not refresh Apple transcription languages: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!transcription.length) {
      language.setMessage("No languages available");
      translationLanguage.setMessage("No languages available");
      throw new Error("Apple reported no on-device transcription languages available on this Mac.");
    }
    const selectedSource = resolveLanguageSelection(settings.language || "en-US", transcription, "en-US");
    language.setOptions(languageModels(transcription), selectedSource);
    await updateTargetOptions(settings.translationLanguage || "en-US");
    translationChoices.forEach((choice) => {
      choice.checked = choice.value === (settings.translationEnabled === false ? "no" : "yes");
    });
    selectedShortcut = settings.globalShortcut === null
      ? null
      : settings.globalShortcut || DEFAULT_SHORTCUT;
    renderShortcut();
    updateTranslationChoice();
    await refreshTranscriptionAvailability();
    await refreshTranslationAvailability();
  }).catch(showError);
}

renderShortcut();
renderStep();
