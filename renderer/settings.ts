import { filterLanguages, languageModels, sameTranslationLanguage, type LanguageModel } from "./language-catalog.js";
import { DEFAULT_SHORTCUT, acceleratorFromEvent, display } from "./shortcut.js";

const byId = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
const overlayLineCount = byId<HTMLSelectElement>("overlayLineCount");
const transcriptionModels = byId<HTMLElement>("transcriptionModels");
const translationModels = byId<HTMLElement>("translationModels");
const transcriptionEmpty = byId<HTMLElement>("transcriptionEmpty");
const translationEmpty = byId<HTMLElement>("translationEmpty");
const notice = byId<HTMLElement>("notice");
const shortcutRecorder = byId<HTMLButtonElement>("shortcutRecorder");
const shortcutRemove = byId<HTMLButtonElement>("shortcutRemove");
const addDialog = byId<HTMLDialogElement>("addLanguageDialog");
const addTitle = byId<HTMLElement>("addLanguageTitle");
const addSearch = byId<HTMLInputElement>("addLanguageSearch");
const addResults = byId<HTMLElement>("addLanguageResults");
const addState = byId<HTMLElement>("addLanguageState");
const addRetry = byId<HTMLButtonElement>("addLanguageRetry");
const navButtons = [...document.querySelectorAll<HTMLButtonElement>(".nav-button[data-panel]")];
const panels = [...document.querySelectorAll<HTMLElement>("[data-panel-content]")];

type ModelKind = "transcription" | "translation";
type ModelView = LanguageModel & { availability?: ModelAvailability };

let current: CaptureSettings;
let sourceLanguage = "ja-JP";
let library: LanguageLibrary;
let transcription: ModelView[] = [];
let translation: ModelView[] = [];
let selectedShortcut: string | null = DEFAULT_SHORTCUT;
let recordingShortcut = false;
let addKind: ModelKind = "transcription";
let catalog: LanguageModel[] = [];

function showPanel(name?: string): void {
  panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panelContent === name));
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.panel === name));
}
function showError(error: unknown): void {
  notice.textContent = error instanceof Error ? error.message : String(error);
  notice.classList.remove("hidden");
}
function clearError(): void { notice.classList.add("hidden"); }
function renderShortcut(): void {
  shortcutRecorder.textContent = recordingShortcut ? "Press shortcut…" : display(selectedShortcut);
  shortcutRecorder.classList.toggle("recording", recordingShortcut);
  shortcutRemove.disabled = !selectedShortcut;
}
function stopShortcutRecording(): void {
  recordingShortcut = false;
  void window.captions.setShortcutRecording(false);
  renderShortcut();
}

function actionButton(label: string, handler: () => void, className = "model-action-button"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function rowFor(model: ModelView, kind: ModelKind): HTMLElement {
  const row = document.createElement("div");
  row.className = "model-row";
  const copy = document.createElement("span");
  copy.className = "model-copy";
  const strong = document.createElement("strong");
  strong.textContent = model.name;
  const small = document.createElement("small");
  small.textContent = `${model.nativeName} · ${model.value}`;
  copy.append(strong, small);
  const trailing = document.createElement("span");
  trailing.className = "model-trailing";
  const status = document.createElement("span");
  status.className = "model-status";
  status.textContent = !model.availability ? "Checking…"
    : !model.availability.supported ? "Unavailable for current source"
      : model.availability.installed ? "Ready" : "Not downloaded";
  trailing.append(status);
  if (model.availability?.supported) {
    if (!model.availability.installed) {
      trailing.append(actionButton("Download", () => void mutate(
        kind === "transcription"
          ? { type: "prepare-transcription", language: model.value }
          : { type: "prepare-translation", language: model.value }
      )));
    } else if (kind === "transcription" && model.availability.deletable) {
      trailing.append(actionButton("Delete model", () => {
        if (window.confirm(`Delete the ${model.name} transcription model? The language stays enabled.`)) {
          void mutate({ type: "delete-transcription", language: model.value });
        }
      }, "model-action-button delete"));
    }
  }
  trailing.append(actionButton("Disable", () => void mutate({ type: "disable", kind, language: model.value }), "model-disable"));
  row.append(copy, trailing);
  return row;
}

function renderEnabled(): void {
  const transcriptionAvailability = new Map(transcription.map((item) => [item.value, item.availability]));
  const translationAvailability = new Map(translation.map((item) => [item.value, item.availability]));
  transcription = languageModels(library.enabledTranscriptionLanguages).map((model) => ({
    ...model, availability: transcriptionAvailability.get(model.value)
  }));
  translation = languageModels(library.enabledTranslationLanguages).map((model) => ({
    ...model, availability: translationAvailability.get(model.value)
  }));
  transcriptionModels.replaceChildren(...transcription.map((model) => rowFor(model, "transcription")));
  translationModels.replaceChildren(...translation.map((model) => rowFor(model, "translation")));
  transcriptionEmpty.classList.toggle("hidden", transcription.length > 0);
  translationEmpty.classList.toggle("hidden", translation.length > 0);
}

function applyStatus(result: LanguageLibraryStatus): void {
  library = result.library;
  const t = new Map(result.transcription.map((item) => [item.language, item.availability]));
  const x = new Map(result.translation.map((item) => [item.language, item.availability]));
  transcription = languageModels(library.enabledTranscriptionLanguages).map((model) => ({ ...model, availability: t.get(model.value) }));
  translation = languageModels(library.enabledTranslationLanguages).map((model) => ({ ...model, availability: x.get(model.value) }));
  renderEnabled();
}

async function mutate(action: LanguageLibraryAction): Promise<boolean> {
  clearError();
  try { applyStatus(await window.captions.runLanguageLibraryAction(action)); return true; }
  catch (error) { showError(error); renderEnabled(); return false; }
}

function renderCatalog(): void {
  const visible = filterLanguages(catalog, addSearch.value);
  addResults.replaceChildren(...visible.map((model) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "catalog-row";
    row.innerHTML = `<strong></strong><small></small>`;
    row.querySelector("strong")!.textContent = model.name;
    row.querySelector("small")!.textContent = `${model.nativeName} · ${model.value}`;
    row.addEventListener("click", async () => {
      if (await mutate({ type: "enable", kind: addKind, language: model.value })) addDialog.close();
    });
    return row;
  }));
  addState.textContent = visible.length ? "" : catalog.length ? "No languages match your search." : "No languages can be enabled.";
}

async function loadCatalog(): Promise<void> {
  addState.textContent = "Loading Apple’s language catalog…";
  addRetry.classList.add("hidden");
  addResults.replaceChildren();
  try {
    sourceLanguage = (await window.captions.getSessionSettings()).language;
    const identifiers = addKind === "transcription"
      ? await window.captions.getTranscriptionLanguages()
      : await window.captions.getTranslationLanguages(sourceLanguage);
    const enabled = new Set((addKind === "transcription"
      ? library.enabledTranscriptionLanguages
      : library.enabledTranslationLanguages).map((value) => value.toLocaleLowerCase()));
    catalog = languageModels(identifiers).filter((model) => (
      !enabled.has(model.value.toLocaleLowerCase())
      && (addKind === "transcription" || !sameTranslationLanguage(model.value, sourceLanguage))
    ));
    renderCatalog();
  } catch (error) {
    catalog = [];
    addState.textContent = `Apple’s catalog couldn’t be loaded. ${error instanceof Error ? error.message : String(error)}`;
    addRetry.classList.remove("hidden");
  }
}

function openCatalog(kind: ModelKind): void {
  addKind = kind;
  addTitle.textContent = `Add ${kind} language`;
  addSearch.value = "";
  addDialog.showModal();
  void loadCatalog();
}

async function persistGeneral(): Promise<void> {
  try {
    current = await window.captions.saveSettings({
      ...current,
      overlayLineCount: Number(overlayLineCount.value),
      globalShortcut: selectedShortcut
    });
    clearError();
  } catch (error) { showError(error); }
}

navButtons.forEach((button) => button.addEventListener("click", () => showPanel(button.dataset.panel)));
byId<HTMLButtonElement>("addTranscription").addEventListener("click", () => openCatalog("transcription"));
byId<HTMLButtonElement>("addTranslation").addEventListener("click", () => openCatalog("translation"));
byId<HTMLButtonElement>("addLanguageClose").addEventListener("click", () => addDialog.close());
addRetry.addEventListener("click", () => { void loadCatalog(); });
addSearch.addEventListener("input", renderCatalog);
overlayLineCount.addEventListener("change", () => { void persistGeneral(); });
shortcutRecorder.addEventListener("click", () => {
  recordingShortcut = true; void window.captions.setShortcutRecording(true); clearError(); renderShortcut();
});
shortcutRemove.addEventListener("click", () => {
  selectedShortcut = null; stopShortcutRecording(); void persistGeneral();
});
document.addEventListener("keydown", (event) => {
  if (!recordingShortcut) return;
  event.preventDefault(); event.stopPropagation();
  const result = acceleratorFromEvent(event);
  if (result.pending) return;
  if (result.cancelled) return stopShortcutRecording();
  if (result.error) return showError(result.error);
  selectedShortcut = result.accelerator ?? null;
  stopShortcutRecording();
  void persistGeneral();
}, true);

Promise.all([window.captions.getSettings(), window.captions.getLanguageLibrary()]).then(([settings, enabled]) => {
  current = settings;
  sourceLanguage = settings.language;
  library = enabled;
  selectedShortcut = current.globalShortcut;
  overlayLineCount.value = String(current.overlayLineCount);
  renderShortcut();
  renderEnabled();
  void mutate({ type: "refresh" });
}).catch(showError);
window.captions.onLanguageLibrary((enabled) => { library = enabled; renderEnabled(); });
window.addEventListener("beforeunload", () => { void window.captions.setShortcutRecording(false); });
