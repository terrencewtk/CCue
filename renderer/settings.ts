import { filterLanguages, languageModels, type LanguageModel } from "./language-catalog.js";
import { DEFAULT_SHORTCUT, acceleratorFromEvent, display } from "./shortcut.js";

const byId = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
const translationEnabled = byId<HTMLInputElement>("translationEnabled");
const overlayLineCount = byId<HTMLSelectElement>("overlayLineCount");
const transcriptionModels = byId<HTMLElement>("transcriptionModels");
const translationModels = byId<HTMLElement>("translationModels");
const transcriptionSearch = byId<HTMLInputElement>("transcriptionSearch");
const translationSearch = byId<HTMLInputElement>("translationSearch");
const transcriptionEmpty = byId<HTMLElement>("transcriptionEmpty");
const translationEmpty = byId<HTMLElement>("translationEmpty");
const modelLoading = byId<HTMLElement>("modelLoading");
const modelError = byId<HTMLElement>("modelError");
const modelErrorMessage = byId<HTMLElement>("modelErrorMessage");
const modelRetry = byId<HTMLButtonElement>("modelRetry");
const modelSettingsForm = byId<HTMLFormElement>("modelSettingsForm");
const notice = byId<HTMLElement>("notice");
const shortcutRecorder = byId<HTMLButtonElement>("shortcutRecorder");
const shortcutRemove = byId<HTMLButtonElement>("shortcutRemove");
const navButtons = [...document.querySelectorAll<HTMLButtonElement>(".nav-button[data-panel]")];
const panels = [...document.querySelectorAll<HTMLElement>("[data-panel-content]")];

type ModelKind = "transcription" | "translation";
type ModelView = LanguageModel & { availability: ModelAvailability };

let current: CaptureSettings = {
  language: "ja-JP", translationEnabled: true, translationLanguage: "en-US",
  overlayLineCount: 3, globalShortcut: DEFAULT_SHORTCUT
};
let selectedTranslationLanguage: string | null = "en-US";
let transcription: ModelView[] = [];
let translation: ModelView[] = [];
let selectedShortcut: string | null = DEFAULT_SHORTCUT;
let recordingShortcut = false;

const icons = {
  ready: '<path d="m7.5 12.2 3 3 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  missing: '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5m0 3v.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  error: '<path d="M12 4 21 20H3L12 4Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 9v5m0 3v.01" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  download: '<path d="M12 4v10m-4-4 4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  trash: '<path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5" fill="none" stroke="currentColor" stroke-width="1.8"/>'
};
function icon(name: keyof typeof icons): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
}

function showPanel(name?: string): void {
  panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panelContent === name));
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.panel === name));
  byId<HTMLElement>("modelPanel").parentElement!.scrollTop = 0;
}
function showError(error: unknown): void {
  notice.textContent = error instanceof Error ? error.message : String(error);
  notice.classList.remove("hidden");
}
function clearError(): void { notice.classList.add("hidden"); }
function settings(): CaptureSettings {
  return { ...current, translationEnabled: translationEnabled.checked,
    overlayLineCount: Number(overlayLineCount.value), globalShortcut: selectedShortcut };
}
function renderShortcut(): void {
  shortcutRecorder.textContent = recordingShortcut ? "Press shortcut…" : display(selectedShortcut);
  shortcutRecorder.classList.toggle("recording", recordingShortcut);
  shortcutRecorder.setAttribute("aria-pressed", String(recordingShortcut));
  shortcutRemove.disabled = !selectedShortcut;
}
function stopShortcutRecording(): void {
  recordingShortcut = false;
  void window.captions.setShortcutRecording(false);
  renderShortcut();
}
function setModelPane(state: "loading" | "result" | "error", error?: unknown): void {
  modelLoading.classList.toggle("hidden", state !== "loading");
  modelSettingsForm.classList.toggle("hidden", state !== "result");
  modelError.classList.toggle("hidden", state !== "error");
  if (state === "error") {
    const detail = error instanceof Error ? error.message : String(error);
    modelErrorMessage.textContent = `Model settings couldn’t be loaded. ${detail}`;
  }
}

function rowFor(model: ModelView, kind: ModelKind): HTMLElement {
  const row = document.createElement("div");
  row.className = "model-row";
  row.dataset.language = model.value;
  const label = document.createElement("label");
  label.className = "model-choice";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = `${kind}Model`;
  input.value = model.value;
  input.checked = kind === "transcription" ? model.value === current.language : model.value === selectedTranslationLanguage;
  const marker = document.createElement("span");
  marker.className = "radio-marker";
  const copy = document.createElement("span");
  copy.className = "model-copy";
  const strong = document.createElement("strong");
  strong.textContent = model.name;
  const small = document.createElement("small");
  small.textContent = model.nativeName;
  copy.append(strong, small);
  label.append(input, marker, copy);
  const trailing = document.createElement("span");
  trailing.className = "model-trailing";
  const status = document.createElement("span");
  const ready = model.availability.supported && model.availability.installed;
  const state = !model.availability.supported ? "unavailable" : ready ? "ready" : "missing";
  status.className = `model-status ${state}`;
  status.innerHTML = `${icon(state === "ready" ? "ready" : state === "missing" ? "missing" : "error")}<span>${state === "ready" ? "Ready" : state === "missing" ? "Not downloaded" : "Unavailable"}</span>`;
  trailing.append(status);
  if (model.availability.supported && (!ready || (kind === "transcription" && model.availability.deletable))) {
    const button = document.createElement("button");
    const deleting = ready;
    button.className = `model-download${deleting ? " delete" : ""}`;
    button.type = "button";
    button.title = `${deleting ? "Delete" : "Download"} ${model.name}`;
    button.setAttribute("aria-label", `${deleting ? "Delete" : "Download"} ${model.name} model`);
    button.innerHTML = icon(deleting ? "trash" : "download");
    button.addEventListener("click", () => {
      if (deleting && !window.confirm(`Delete the ${model.name} transcription model? You can download it again later.`)) return;
      const action: ModelSettingsAction = deleting
        ? { type: "delete-transcription", language: model.value }
        : kind === "transcription"
          ? { type: "prepare-transcription", language: model.value }
          : { type: "prepare-translation", language: model.value };
      void refreshModels(settings(), action);
    });
    trailing.append(button);
  }
  input.addEventListener("change", () => {
    const candidate = settings();
    if (kind === "transcription") candidate.language = model.value;
    else candidate.translationLanguage = model.value;
    void refreshModels(candidate);
  });
  row.append(label, trailing);
  return row;
}

function applyFilter(kind: ModelKind): void {
  const models = kind === "transcription" ? transcription : translation;
  const search = kind === "transcription" ? transcriptionSearch : translationSearch;
  const list = kind === "transcription" ? transcriptionModels : translationModels;
  const empty = kind === "transcription" ? transcriptionEmpty : translationEmpty;
  const visible = new Set(filterLanguages(models, search.value).map((model) => model.value));
  list.querySelectorAll<HTMLElement>(".model-row").forEach((row) => row.classList.toggle("hidden", !visible.has(row.dataset.language ?? "")));
  empty.textContent = models.length ? `No ${kind} languages match your search.` : `Apple reported no ${kind} languages available on this Mac.`;
  empty.classList.toggle("hidden", visible.size > 0);
}

function attachAvailability(items: ModelLanguageState[]): ModelView[] {
  const availability = new Map(items.map((item) => [item.language, item.availability]));
  return languageModels(items.map((item) => item.language)).map((model) => ({ ...model, availability: availability.get(model.value)! }));
}
function renderModelResult(result: ModelSettingsResult): void {
  current = result.settings;
  selectedTranslationLanguage = result.selectedTranslationLanguage;
  translationEnabled.checked = current.translationEnabled;
  translationEnabled.disabled = result.translation.length === 0;
  transcription = attachAvailability(result.transcription);
  translation = attachAvailability(result.translation);
  transcriptionModels.replaceChildren(...transcription.map((model) => rowFor(model, "transcription")));
  translationModels.replaceChildren(...translation.map((model) => rowFor(model, "translation")));
  translationModels.classList.toggle("disabled", !current.translationEnabled);
  translationSearch.disabled = !current.translationEnabled || translation.length === 0;
  translationModels.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((control) => { control.disabled = !current.translationEnabled; });
  applyFilter("transcription");
  applyFilter("translation");
  setModelPane("result");
}
async function refreshModels(candidate: CaptureSettings, action?: ModelSettingsAction): Promise<void> {
  current = candidate;
  setModelPane("loading");
  try {
    renderModelResult(await window.captions.runModelSettings(candidate, action));
    clearError();
  } catch (error) { setModelPane("error", error); }
}
async function persistGeneral(candidate = settings()): Promise<boolean> {
  try { current = await window.captions.saveSettings(candidate); clearError(); return true; }
  catch (error) { showError(error); return false; }
}

navButtons.forEach((button) => button.addEventListener("click", () => showPanel(button.dataset.panel)));
if (!window.captions) {
  showError("Electron preload bridge is unavailable. Restart the app or reinstall this build.");
  setModelPane("error", "Electron preload bridge is unavailable.");
} else {
  window.captions.getSettings().then((stored) => {
    current = stored;
    selectedShortcut = stored.globalShortcut;
    overlayLineCount.value = String(stored.overlayLineCount);
    translationEnabled.checked = stored.translationEnabled;
    renderShortcut();
    return refreshModels(stored);
  }).catch((error) => setModelPane("error", error));
  modelRetry.addEventListener("click", () => { void refreshModels(settings()); });
  translationEnabled.addEventListener("change", () => { void refreshModels(settings()); });
  transcriptionSearch.addEventListener("input", () => applyFilter("transcription"));
  translationSearch.addEventListener("input", () => applyFilter("translation"));
  overlayLineCount.addEventListener("change", () => { void persistGeneral(); });
  shortcutRecorder.addEventListener("click", () => {
    recordingShortcut = true; void window.captions.setShortcutRecording(true); clearError(); renderShortcut();
  });
  shortcutRemove.addEventListener("click", async () => {
    const previous = selectedShortcut; selectedShortcut = null; stopShortcutRecording();
    if (!await persistGeneral()) { selectedShortcut = previous; renderShortcut(); }
  });
  document.addEventListener("keydown", async (event) => {
    if (!recordingShortcut) return;
    event.preventDefault(); event.stopPropagation();
    const result = acceleratorFromEvent(event);
    if (result.pending) return;
    if (result.cancelled) return stopShortcutRecording();
    if (result.error) return showError(result.error);
    const previous = selectedShortcut; selectedShortcut = result.accelerator ?? null; stopShortcutRecording();
    if (!await persistGeneral()) { selectedShortcut = previous; renderShortcut(); }
  }, true);
  window.addEventListener("beforeunload", () => { void window.captions.setShortcutRecording(false); });
}
