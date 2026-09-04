import {
  TRANSCRIPTION_LANGUAGES,
  TRANSLATION_LANGUAGES,
  createModelChecker,
  type LanguageModel
} from "./model-availability.js";
import { DEFAULT_SHORTCUT, acceleratorFromEvent, display } from "./shortcut.js";

const translationEnabled = document.querySelector<HTMLInputElement>("#translationEnabled")!;
const overlayLineCount = document.querySelector<HTMLSelectElement>("#overlayLineCount")!;
const transcriptionModels = document.querySelector<HTMLElement>("#transcriptionModels")!;
const translationModels = document.querySelector<HTMLElement>("#translationModels")!;
const notice = document.querySelector<HTMLElement>("#notice")!;
const shortcutRecorder = document.querySelector<HTMLButtonElement>("#shortcutRecorder")!;
const shortcutRemove = document.querySelector<HTMLButtonElement>("#shortcutRemove")!;
const navButtons = [...document.querySelectorAll<HTMLButtonElement>(".nav-button[data-panel]")];
const categoryButtons = [...document.querySelectorAll<HTMLButtonElement>("nav .nav-button[data-panel]")];
const panels = [...document.querySelectorAll<HTMLElement>("[data-panel-content]")];
const modelChecker = createModelChecker(window.captions);

let selectedLanguage = "ja-JP";
let selectedTranslationLanguage = "en-US";
type ModelKind = "transcription" | "translation";
type ModelState = "checking" | "ready" | "missing" | "downloading" | "unavailable" | "check-error" | "error" | "deleting" | "delete-error";
type IconName = "checking" | "ready" | "missing" | "error" | "download" | "retry" | "trash";
let activeDownload: { kind: ModelKind; value: string } | null = null;
let refreshGeneration = 0;
let selectedShortcut: string | null = DEFAULT_SHORTCUT;
let recordingShortcut = false;
const runModelOperation = modelChecker.run;

function icon(name: IconName): string {
  const paths: Record<IconName, string> = {
    checking: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="10 5"/>',
    ready: '<path d="m7.5 12.2 3 3 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    missing: '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5m0 3v.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    error: '<path d="M12 4 21 20H3L12 4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5m0 3v.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    download: '<path d="M12 4v10m-4-4 4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    retry: '<path d="M19 8a8 8 0 1 0 .5 7M19 4v4h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    trash: '<path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function modelRow(model: LanguageModel, kind: ModelKind): HTMLElement {
  const row = document.createElement("div");
  row.className = "model-row";
  row.dataset.kind = kind;
  row.dataset.language = model.value;
  row.dataset.state = "checking";

  const label = document.createElement("label");
  label.className = "model-choice";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = `${kind}Model`;
  input.value = model.value;
  input.checked = kind === "transcription"
    ? model.value === selectedLanguage
    : model.value === selectedTranslationLanguage;
  const marker = document.createElement("span");
  marker.className = "radio-marker";
  const copy = document.createElement("span");
  copy.className = "model-copy";
  copy.innerHTML = `<strong>${model.name}</strong><small>${model.nativeName}</small><span class="model-explanation hidden"></span><span class="model-progress hidden"><span></span></span>`;
  label.append(input, marker, copy);

  const trailing = document.createElement("span");
  trailing.className = "model-trailing";
  const status = document.createElement("span");
  status.className = "model-status checking";
  status.innerHTML = `${icon("checking")}<span>Checking</span>`;
  const action = document.createElement("button");
  action.className = "model-download hidden";
  action.type = "button";
  action.title = `Download ${model.name}`;
  action.setAttribute("aria-label", `Download ${model.name} model`);
  action.innerHTML = icon("download");
  trailing.append(status, action);
  row.append(label, trailing);

  input.addEventListener("change", () => selectModel(kind, model.value));
  action.addEventListener("click", () => {
    if (row.dataset.state === "check-error") retryModelCheck(kind, model.value);
    else if (["ready", "delete-error"].includes(row.dataset.state ?? "")) deleteModel(kind, model.value);
    else downloadModel(kind, model.value);
  });
  return row;
}

function renderModelLists(): void {
  transcriptionModels.replaceChildren(...TRANSCRIPTION_LANGUAGES.map((model) => modelRow(model, "transcription")));
  translationModels.replaceChildren(...TRANSLATION_LANGUAGES.map((model) => modelRow(model, "translation")));
  updateTranslationControls();
}

function findRow(kind: ModelKind, value: string): HTMLElement | undefined {
  const list = kind === "transcription" ? transcriptionModels : translationModels;
  return [...list.querySelectorAll<HTMLElement>(".model-row")].find((row) => row.dataset.language === value);
}

function applyAvailability(kind: ModelKind, value: string, availability: ModelAvailability): void {
  const row = findRow(kind, value);
  if (row) row.dataset.deletable = String(availability.deletable === true);
  if (availability.supported) {
    setModelState(kind, value, availability.installed ? "ready" : "missing");
    return;
  }
  const target = (kind === "transcription" ? TRANSCRIPTION_LANGUAGES : TRANSLATION_LANGUAGES)
    .find((model) => model.value === value)?.name || value;
  const source = TRANSCRIPTION_LANGUAGES.find((model) => model.value === selectedLanguage)?.name
    || selectedLanguage;
  const detail = kind === "translation"
    ? `Apple Translation reported that ${source} to ${target} is not supported on this Mac.`
    : `Apple transcription reported that ${target} is not supported on this Mac.`;
  setModelState(kind, value, "unavailable", detail);
}

function setModelState(kind: ModelKind, value: string, state: ModelState, detail = "", percent?: number): void {
  const row = findRow(kind, value);
  if (!row) return;
  row.dataset.state = state;
  const status = row.querySelector<HTMLElement>(".model-status")!;
  const action = row.querySelector<HTMLButtonElement>(".model-download")!;
  const progress = row.querySelector<HTMLElement>(".model-progress")!;
  const progressFill = progress.querySelector<HTMLElement>("span")!;
  const explanation = row.querySelector<HTMLElement>(".model-explanation")!;
  const model = (kind === "transcription" ? TRANSCRIPTION_LANGUAGES : TRANSLATION_LANGUAGES)
    .find((candidate) => candidate.value === value)!;
  const stateView: [IconName, string] = ({
    checking: ["checking", "Checking"],
    ready: ["ready", "Ready"],
    missing: ["missing", "Not downloaded"],
    downloading: ["checking", typeof percent === "number" ? `${percent}%` : "Preparing"],
    unavailable: ["error", "Unavailable"],
    "check-error": ["error", "Couldn’t check"],
    error: ["error", "Download failed"],
    deleting: ["checking", "Deleting"],
    "delete-error": ["error", "Couldn’t delete"]
  } satisfies Record<ModelState, [IconName, string]>)[state];
  status.className = `model-status ${state}`;
  status.innerHTML = `${icon(stateView[0])}<span>${stateView[1]}</span>`;
  status.title = detail;
  status.setAttribute("aria-label", detail ? `${stateView[1]}: ${detail}` : stateView[1]);
  const canDelete = kind === "transcription"
    && row.dataset.deletable === "true"
    && ["ready", "delete-error"].includes(state);
  action.classList.toggle("hidden", !canDelete && !["missing", "check-error", "error"].includes(state));
  const retryingCheck = state === "check-error";
  action.classList.toggle("delete", canDelete);
  action.innerHTML = icon(canDelete ? "trash" : retryingCheck ? "retry" : "download");
  action.title = canDelete
    ? `Delete ${model.name}`
    : retryingCheck ? "Check availability again" : `Download ${model.name}`;
  action.setAttribute("aria-label", canDelete
    ? `Delete ${model.name} model`
    : retryingCheck ? `Check ${model.name} availability again` : `Download ${model.name} model`);
  action.disabled = Boolean(activeDownload);
  progress.classList.toggle("hidden", state !== "downloading");
  progressFill.style.width = `${typeof percent === "number" ? percent : 12}%`;

  const subtitle = row.querySelector<HTMLElement>(".model-copy small")!;
  subtitle.textContent = state === "downloading"
    ? (detail || "Preparing download…")
    : state === "ready"
      ? `${model.nativeName} · Managed by macOS`
      : model.nativeName;

  const shouldExplain = ["unavailable", "check-error", "error", "delete-error"].includes(state) && detail;
  const fallbackExplanation = state === "check-error"
    ? "Availability check failed. Hover for details."
    : state === "error"
      ? "The download failed. Hover for details."
      : state === "delete-error"
        ? "The model couldn’t be deleted. Hover for details."
      : kind === "translation"
        ? "Not supported for the selected spoken language."
        : "Not supported on this Mac.";
  explanation.textContent = shouldExplain
    ? (detail.length <= 90 ? detail : fallbackExplanation)
    : "";
  explanation.title = shouldExplain && detail.length > 90 ? detail : "";
  explanation.classList.toggle("hidden", !shouldExplain);
}

function showPanel(panelName?: string): void {
  panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panelContent === panelName));
  navButtons.forEach((button) => button.classList.remove("active"));
  const category = categoryButtons.find((button) => button.dataset.panel === panelName);
  category?.classList.add("active");
  document.querySelector<HTMLElement>(".content-pane")!.scrollTop = 0;
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => showPanel(button.dataset.panel));
});

function showError(error: unknown): void {
  notice.textContent = error instanceof Error ? error.message : String(error);
  notice.classList.remove("hidden");
}

function clearError(): void {
  notice.classList.add("hidden");
}

function settings(): CaptureSettings {
  return {
    language: selectedLanguage,
    translationEnabled: translationEnabled.checked,
    translationLanguage: selectedTranslationLanguage,
    overlayLineCount: Number(overlayLineCount.value),
    globalShortcut: selectedShortcut
  };
}

function renderShortcut(): void {
  shortcutRecorder.textContent = recordingShortcut
    ? "Press shortcut…"
    : display(selectedShortcut);
  shortcutRecorder.classList.toggle("recording", recordingShortcut);
  shortcutRecorder.setAttribute("aria-pressed", String(recordingShortcut));
  shortcutRemove.disabled = !selectedShortcut;
}

function stopShortcutRecording(): void {
  recordingShortcut = false;
  void window.captions?.setShortcutRecording(false);
  renderShortcut();
}

function updateTranslationControls(): void {
  translationModels.classList.toggle("disabled", !translationEnabled.checked);
  translationModels.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((control) => {
    const sameAsSource = control.closest<HTMLElement>(".model-row")?.dataset.language === selectedLanguage;
    control.disabled = !translationEnabled.checked || sameAsSource || Boolean(activeDownload);
  });
  const sameLanguageRow = findRow("translation", selectedLanguage);
  if (sameLanguageRow) {
    const status = sameLanguageRow.querySelector<HTMLElement>(".model-status")!;
    const explanation = sameLanguageRow.querySelector<HTMLElement>(".model-explanation")!;
    status.className = "model-status unavailable";
    status.innerHTML = '<span>Same as spoken</span>';
    status.title = "Choose a different language for translation";
    status.setAttribute("aria-label", "Same as spoken: choose a different language for translation");
    explanation.textContent = "";
    explanation.title = "";
    explanation.classList.add("hidden");
    sameLanguageRow.querySelector<HTMLElement>(".model-download")!.classList.add("hidden");
  }
}

async function selectModel(kind: ModelKind, value: string): Promise<void> {
  if (kind === "transcription") {
    selectedLanguage = value;
    if (selectedTranslationLanguage === value) {
      selectedTranslationLanguage = TRANSLATION_LANGUAGES.find((model) => model.value !== value)?.value || "en-US";
      const nextTarget = findRow("translation", selectedTranslationLanguage)?.querySelector<HTMLInputElement>("input");
      if (nextTarget) nextTarget.checked = true;
    }
    updateTranslationControls();
    await persistSettings();
    await refreshTranslationModels();
  } else {
    selectedTranslationLanguage = value;
    await persistSettings();
  }
}

async function refreshModels(): Promise<void> {
  const generation = ++refreshGeneration;
  for (const model of TRANSCRIPTION_LANGUAGES) {
    setModelState("transcription", model.value, "checking");
    try {
      const result = await runModelOperation(() => (
        window.captions.getTranscriptionModelAvailability(model.value)
      ));
      if (generation !== refreshGeneration) return;
      applyAvailability("transcription", model.value, result);
    } catch (error) {
      if (generation !== refreshGeneration) return;
      setModelState("transcription", model.value, "check-error", error instanceof Error ? error.message : String(error));
    }
  }
  await refreshTranslationModels(generation);
}

async function refreshTranslationModels(existingGeneration?: number): Promise<void> {
  const generation = existingGeneration ?? ++refreshGeneration;
  for (const model of TRANSLATION_LANGUAGES) {
    if (model.value === selectedLanguage) {
      updateTranslationControls();
      continue;
    }
    setModelState("translation", model.value, "checking");
    try {
      const sourceLanguage = selectedLanguage;
      const result = await runModelOperation(() => (
        window.captions.getTranslationModelAvailability(sourceLanguage, model.value)
      ));
      if (generation !== refreshGeneration) return;
      applyAvailability("translation", model.value, result);
    } catch (error) {
      if (generation !== refreshGeneration) return;
      setModelState("translation", model.value, "check-error", error instanceof Error ? error.message : String(error));
    }
  }
  updateTranslationControls();
}

async function retryModelCheck(kind: ModelKind, value: string): Promise<void> {
  setModelState(kind, value, "checking");
  try {
    const result = kind === "transcription"
      ? await runModelOperation(() => window.captions.getTranscriptionModelAvailability(value))
      : await runModelOperation(() => window.captions.getTranslationModelAvailability(selectedLanguage, value));
    applyAvailability(kind, value, result);
    clearError();
  } catch (error) {
    setModelState(kind, value, "check-error", error instanceof Error ? error.message : String(error));
  }
  updateTranslationControls();
}

async function downloadModel(kind: ModelKind, value: string): Promise<void> {
  if (activeDownload) return;
  activeDownload = { kind, value };
  setModelState(kind, value, "downloading", "Preparing download…", 0);
  document.querySelectorAll<HTMLButtonElement>(".model-download").forEach((button) => { button.disabled = true; });
  try {
    if (kind === "transcription") {
      await runModelOperation(() => window.captions.prepareTranscriptionModel(value));
      const row = findRow(kind, value);
      if (row) row.dataset.deletable = "true";
    } else {
      const sourceLanguage = selectedLanguage;
      await runModelOperation(() => window.captions.prepareTranslationModels(sourceLanguage, value));
    }
    setModelState(kind, value, "ready");
    clearError();
  } catch (error) {
    setModelState(kind, value, "error", error instanceof Error ? error.message : String(error));
    showError(error);
  } finally {
    activeDownload = null;
    document.querySelectorAll<HTMLButtonElement>(".model-download").forEach((button) => { button.disabled = false; });
    updateTranslationControls();
  }
}

async function deleteModel(kind: ModelKind, value: string): Promise<void> {
  if (kind !== "transcription" || activeDownload) return;
  const model = TRANSCRIPTION_LANGUAGES.find((candidate) => candidate.value === value)!;
  if (!window.confirm(`Delete the ${model.name} transcription model? You can download it again later.`)) return;

  activeDownload = { kind, value };
  setModelState(kind, value, "deleting");
  try {
    await runModelOperation(() => window.captions.deleteTranscriptionModel(value));
    const row = findRow(kind, value);
    if (row) row.dataset.deletable = "false";
    setModelState(kind, value, "missing");
    clearError();
  } catch (error) {
    setModelState(kind, value, "delete-error", error instanceof Error ? error.message : String(error));
    showError(error);
  } finally {
    activeDownload = null;
    const action = findRow(kind, value)?.querySelector<HTMLButtonElement>(".model-download");
    if (action) action.disabled = false;
    updateTranslationControls();
  }
}

function handleModelStatus(status: ModelPreparationStatus): void {
  if (!activeDownload || status.model !== activeDownload.kind) return;
  if (status.state === "ready") setModelState(activeDownload.kind, activeDownload.value, "ready", status.detail, 100);
  else if (status.state === "error") setModelState(activeDownload.kind, activeDownload.value, "error", status.detail);
  else setModelState(activeDownload.kind, activeDownload.value, "downloading", status.detail, status.percent);
}

async function persistSettings(): Promise<boolean> {
  try {
    await window.captions.saveSettings(settings());
    clearError();
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}

if (!window.captions) {
  showError("Electron preload bridge is unavailable. Restart the app or reinstall this build.");
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button").forEach((control) => { control.disabled = true; });
} else {
  window.captions.getSettings().then((stored) => {
    selectedLanguage = stored.language || "ja-JP";
    translationEnabled.checked = stored.translationEnabled !== false;
    selectedTranslationLanguage = stored.translationLanguage || "en-US";
    selectedShortcut = stored.globalShortcut === null
      ? null
      : stored.globalShortcut || DEFAULT_SHORTCUT;
    if (selectedTranslationLanguage === selectedLanguage) {
      selectedTranslationLanguage = TRANSLATION_LANGUAGES.find((model) => model.value !== selectedLanguage)?.value || "en-US";
    }
    overlayLineCount.value = String(stored.overlayLineCount || 3);
    renderShortcut();
    renderModelLists();
    window.captions.onOnboardingModelStatus(handleModelStatus);
    return refreshModels();
  }).catch(showError);

  overlayLineCount.addEventListener("change", persistSettings);
  translationEnabled.addEventListener("change", () => {
    updateTranslationControls();
    persistSettings();
  });

  shortcutRecorder.addEventListener("click", () => {
    recordingShortcut = true;
    void window.captions.setShortcutRecording(true);
    clearError();
    renderShortcut();
  });
  shortcutRemove.addEventListener("click", async () => {
    const previous = selectedShortcut;
    selectedShortcut = null;
    stopShortcutRecording();
    if (!await persistSettings()) {
      selectedShortcut = previous;
      renderShortcut();
    }
  });

  document.addEventListener("keydown", async (event) => {
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
    const previous = selectedShortcut;
    selectedShortcut = result.accelerator ?? null;
    stopShortcutRecording();
    if (!await persistSettings()) {
      selectedShortcut = previous;
      renderShortcut();
    }
  }, true);
  window.addEventListener("beforeunload", () => {
    void window.captions.setShortcutRecording(false);
  });
}
