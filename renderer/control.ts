import {
  createModelChecker,
  SelectedModelReadinessController,
  type SelectedModelSnapshot
} from "./model-availability.js";
import { languageModels, translationTargetsForSource } from "./language-catalog.js";

const captureButton = document.querySelector<HTMLButtonElement>("#captureButton")!;
const captureActions = document.querySelector<HTMLElement>(".capture-actions")!;
const settingsButton = document.querySelector<HTMLButtonElement>("#settingsButton")!;
const statusMessage = document.querySelector<HTMLElement>("#statusMessage")!;
const sessionLanguage = document.querySelector<HTMLSelectElement>("#sessionLanguage")!;
const sessionTranslationEnabled = document.querySelector<HTMLInputElement>("#sessionTranslationEnabled")!;
const sessionTranslationLanguage = document.querySelector<HTMLSelectElement>("#sessionTranslationLanguage")!;

let capturing = false;
let captureState: CaptureStatus["state"] = "idle";
let checking = true;
let ready = false;
let statusDetail = "Loading language settings…";
let snapshot: SelectedModelSnapshot | undefined;

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function placeholder(select: HTMLSelectElement, label: string): void {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = label;
  option.disabled = true;
  option.selected = true;
  select.replaceChildren(option);
}

function options(select: HTMLSelectElement, values: string[], selected: string, empty: string): void {
  const models = languageModels(values);
  if (!models.length) return placeholder(select, empty);
  select.replaceChildren(...models.map((model) => {
    const option = document.createElement("option");
    option.value = model.value;
    option.textContent = model.name;
    return option;
  }));
  if (values.includes(selected)) select.value = selected;
  else {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = `Not enabled: ${selected}`;
    option.disabled = true;
    select.prepend(option);
    select.value = "";
  }
}

function renderLibrary(): void {
  if (!snapshot) return;
  const { settings, library } = snapshot;
  options(sessionLanguage, library.enabledTranscriptionLanguages, settings.language, "No enabled languages");
  sessionTranslationEnabled.checked = settings.translationEnabled;
  const targets = translationTargetsForSource(library.enabledTranslationPairs, settings.language);
  options(sessionTranslationLanguage, targets, settings.translationLanguage, "No compatible enabled targets");
  updateControls();
}

function currentSettings(): CaptureSettings {
  if (!snapshot) throw new Error("Language settings are still loading.");
  return {
    ...snapshot.settings,
    language: sessionLanguage.value || snapshot.settings.language,
    translationEnabled: sessionTranslationEnabled.checked,
    translationLanguage: sessionTranslationLanguage.value || snapshot.settings.translationLanguage
  };
}

function updateControls(): void {
  captureButton.classList.toggle("busy", checking || captureState === "connecting");
  if (!snapshot) {
    sessionLanguage.disabled = true;
    sessionTranslationEnabled.disabled = true;
    sessionTranslationLanguage.disabled = true;
    captureButton.disabled = true;
    captureActions.dataset.disabledReason = statusDetail;
    return;
  }
  const busy = capturing || checking;
  sessionLanguage.disabled = busy || snapshot.library.enabledTranscriptionLanguages.length === 0;
  const hasTargets = translationTargetsForSource(
    snapshot.library.enabledTranslationPairs,
    sessionLanguage.value
  ).length > 0;
  sessionTranslationEnabled.disabled = busy || (!hasTargets && !sessionTranslationEnabled.checked);
  sessionTranslationLanguage.disabled = busy || !hasTargets || !sessionTranslationEnabled.checked;
  captureButton.disabled = captureState === "connecting" || (!capturing && (checking || !ready));
  if (captureButton.disabled) captureActions.dataset.disabledReason = statusDetail;
  else delete captureActions.dataset.disabledReason;
}

function renderStatus({ state, detail }: CaptureStatus): void {
  captureState = state;
  capturing = state === "capturing" || state === "connecting";
  const label = { idle: "Ready", connecting: "Connecting", capturing: "Capturing system audio", error: "Needs attention" }[state];
  statusDetail = detail || "Waiting to start";
  statusMessage.textContent = `${label}. ${statusDetail}`;
  captureButton.textContent = capturing ? "Stop captions" : "Start captions";
  captureButton.classList.toggle("stop", capturing);
  updateControls();
}

const readiness = new SelectedModelReadinessController(
  createModelChecker(window.captions),
  () => {
    checking = true;
    ready = false;
    if (!capturing) renderStatus({ state: "idle", detail: "Checking selected models…" });
  },
  (_checked, result) => {
    checking = false;
    ready = result.ready;
    if (!capturing) renderStatus({ state: result.ready ? "idle" : "error", detail: result.detail });
  }
);

function applySnapshot(next: SelectedModelSnapshot): void {
  snapshot = next;
  renderLibrary();
  readiness.request(snapshot);
}

async function persistSelection(): Promise<void> {
  if (!snapshot) return;
  snapshot = { ...snapshot, settings: await window.captions.saveSessionSettings(currentSettings()) };
  renderLibrary();
  readiness.request(snapshot);
}

if (!window.captions) throw new Error("Electron preload bridge is unavailable");

captureButton.addEventListener("click", async () => {
  captureButton.disabled = true;
  try {
    if (capturing) await window.captions.stop();
    else await window.captions.start(await window.captions.saveSessionSettings(currentSettings()));
  } catch (error) {
    renderStatus({ state: "error", detail: messageFrom(error) });
  } finally {
    updateControls();
  }
});
settingsButton.addEventListener("click", () => window.captions.showSettings());
sessionLanguage.addEventListener("change", () => { void persistSelection(); });
sessionTranslationEnabled.addEventListener("change", () => { void persistSelection(); });
sessionTranslationLanguage.addEventListener("change", () => { void persistSelection(); });

window.captions.getSessionState().then(applySnapshot).catch((error: unknown) => {
  renderStatus({ state: "error", detail: `Could not load language settings: ${messageFrom(error)}` });
});
window.captions.onSessionSettings((settings) => {
  if (snapshot) applySnapshot({ settings, library: snapshot.library });
});
window.captions.onLanguageLibrary((library) => {
  if (snapshot) applySnapshot({ settings: snapshot.settings, library });
});
window.captions.onStatus(renderStatus);
window.captions.onDebug((event) => console.info(`[caption:${event.source}] ${event.action}`, event));
