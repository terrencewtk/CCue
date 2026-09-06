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
const addSourceField = byId<HTMLElement>("addLanguageSourceField");
const addSource = byId<HTMLSelectElement>("addLanguageSource");
const addTranslation = byId<HTMLButtonElement>("addTranslation");
const navButtons = [...document.querySelectorAll<HTMLButtonElement>(".nav-button[data-panel]")];
const panels = [...document.querySelectorAll<HTMLElement>("[data-panel-content]")];

type ModelKind = "transcription" | "translation";
type ModelView = LanguageModel & { availability?: ModelAvailability };
type TranslationPairView = {
  pair: TranslationPair;
  source: LanguageModel;
  target: LanguageModel;
  availability?: ModelAvailability;
};

let current: CaptureSettings;
let library: LanguageLibrary;
let transcription: ModelView[] = [];
let translation: TranslationPairView[] = [];
let selectedShortcut: string | null = DEFAULT_SHORTCUT;
let recordingShortcut = false;
let addKind: ModelKind = "transcription";
let catalog: LanguageModel[] = [];
let catalogGeneration = 0;

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
function renderPersistedGeneral(): void {
  selectedShortcut = current.globalShortcut;
  overlayLineCount.value = String(current.overlayLineCount);
  renderShortcut();
}
function disableGeneralControls(disabled: boolean): void {
  overlayLineCount.disabled = disabled;
  shortcutRecorder.disabled = disabled;
  shortcutRemove.disabled = disabled || !selectedShortcut;
}
function stopShortcutRecording(): void {
  recordingShortcut = false;
  void window.captions.setShortcutRecording(false);
  renderShortcut();
}

const actionIcons = {
  download: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7M5 7l3 3 3-3M3 13h10" /></svg>',
  delete: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6 2.5h4M5 4.5l.5 9h5l.5-9M7 7v4M9 7v4" /></svg>',
  disable: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M5.5 8h5" /></svg>'
} as const;

function actionButton(
  label: string,
  icon: keyof typeof actionIcons,
  handler: () => void,
  variant = ""
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `model-icon-button ${variant}`.trim();
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = actionIcons[icon];
  button.addEventListener("click", handler);
  return button;
}

function availabilityStatus(availability?: ModelAvailability): string {
  return !availability ? "Checking…"
    : !availability.supported ? "Unavailable"
      : availability.installed ? "Ready" : "Not downloaded";
}

function transcriptionRow(model: ModelView): HTMLElement {
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
  status.textContent = availabilityStatus(model.availability);
  trailing.append(status);
  if (model.availability?.supported) {
    if (!model.availability.installed) {
      trailing.append(actionButton(`Download ${model.name} model`, "download", () => void mutate(
        { type: "prepare-transcription", language: model.value }
      ), "download"));
    } else if (model.availability.deletable) {
      trailing.append(actionButton(`Delete ${model.name} model`, "delete", () => {
        if (window.confirm(`Delete the ${model.name} transcription model? The language stays enabled.`)) {
          void mutate({ type: "delete-transcription", language: model.value });
        }
      }, "danger"));
    }
  }
  const dependentPairs = library.enabledTranslationPairs.filter(
    (pair) => pair.sourceLanguage === model.value
  ).length;
  trailing.append(actionButton(
    `Remove ${model.name} from enabled languages`,
    "disable",
    () => {
      if (
        dependentPairs > 0
        && !window.confirm(`Disable ${model.name}? This also removes ${dependentPairs} translation pair${dependentPairs === 1 ? "" : "s"}.`)
      ) return;
      void mutate({ type: "disable-transcription", language: model.value });
    },
    "ghost"
  ));
  row.append(copy, trailing);
  return row;
}

function translationRow(view: TranslationPairView): HTMLElement {
  const row = document.createElement("div");
  row.className = "model-row";
  const copy = document.createElement("span");
  copy.className = "model-copy";
  const strong = document.createElement("strong");
  strong.textContent = `${view.source.name} → ${view.target.name}`;
  const small = document.createElement("small");
  small.textContent = `${view.source.nativeName} → ${view.target.nativeName} · ${view.pair.sourceLanguage} → ${view.pair.targetLanguage}`;
  copy.append(strong, small);
  const trailing = document.createElement("span");
  trailing.className = "model-trailing";
  const status = document.createElement("span");
  status.className = "model-status";
  status.textContent = availabilityStatus(view.availability);
  trailing.append(status);
  if (view.availability?.supported && !view.availability.installed) {
    trailing.append(actionButton(
      `Download ${view.source.name} to ${view.target.name} translation model`,
      "download",
      () => void mutate({ type: "prepare-translation-pair", ...view.pair }),
      "download"
    ));
  }
  trailing.append(actionButton(
    `Remove ${view.source.name} to ${view.target.name} translation pair`,
    "disable",
    () => void mutate({ type: "disable-translation-pair", ...view.pair }),
    "ghost"
  ));
  row.append(copy, trailing);
  return row;
}

function pairKey(pair: TranslationPair): string {
  return `${pair.sourceLanguage.toLocaleLowerCase("en-US")}\u0000${pair.targetLanguage.toLocaleLowerCase("en-US")}`;
}

function pairViews(pairs: readonly TranslationPair[]): TranslationPairView[] {
  const collator = new Intl.Collator(navigator.languages as string[], { sensitivity: "base", numeric: true });
  return pairs.map((pair) => ({
    pair,
    source: languageModels([pair.sourceLanguage])[0]!,
    target: languageModels([pair.targetLanguage])[0]!
  })).sort((left, right) => (
    collator.compare(left.source.name, right.source.name)
    || collator.compare(left.target.name, right.target.name)
    || pairKey(left.pair).localeCompare(pairKey(right.pair))
  ));
}

function renderEnabled(): void {
  const transcriptionAvailability = new Map(transcription.map((item) => [item.value, item.availability]));
  const translationAvailability = new Map(translation.map((item) => [pairKey(item.pair), item.availability]));
  transcription = languageModels(library.enabledTranscriptionLanguages).map((model) => ({
    ...model, availability: transcriptionAvailability.get(model.value)
  }));
  translation = pairViews(library.enabledTranslationPairs).map((view) => ({
    ...view, availability: translationAvailability.get(pairKey(view.pair))
  }));
  transcriptionModels.replaceChildren(...transcription.map(transcriptionRow));
  translationModels.replaceChildren(...translation.map(translationRow));
  transcriptionEmpty.classList.toggle("hidden", transcription.length > 0);
  translationEmpty.classList.toggle("hidden", translation.length > 0);
  addTranslation.disabled = transcription.length === 0;
  addTranslation.title = transcription.length ? "Add a translation pair" : "Enable a transcription language first";
}

function applyStatus(result: LanguageLibraryStatus): void {
  library = result.library;
  const t = new Map(result.transcription.map((item) => [item.language, item.availability]));
  const x = new Map(result.translation.map((item) => [pairKey(item), item.availability]));
  transcription = languageModels(library.enabledTranscriptionLanguages).map((model) => ({ ...model, availability: t.get(model.value) }));
  translation = pairViews(library.enabledTranslationPairs).map((view) => ({
    ...view, availability: x.get(pairKey(view.pair))
  }));
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
      const action: LanguageLibraryAction = addKind === "transcription"
        ? { type: "enable-transcription", language: model.value }
        : {
          type: "enable-translation-pair",
          sourceLanguage: addSource.value,
          targetLanguage: model.value
        };
      if (await mutate(action)) addDialog.close();
    });
    return row;
  }));
  addState.textContent = visible.length ? "" : catalog.length ? "No languages match your search." : "No languages can be enabled.";
}

async function loadCatalog(): Promise<void> {
  const generation = ++catalogGeneration;
  addState.textContent = "Loading Apple’s language catalog…";
  addRetry.classList.add("hidden");
  addResults.replaceChildren();
  try {
    const sourceLanguage = addSource.value;
    if (addKind === "translation" && !sourceLanguage) {
      catalog = [];
      addState.textContent = "Enable a transcription language before adding a translation pair.";
      return;
    }
    const identifiers = addKind === "transcription"
      ? await window.captions.getTranscriptionLanguages()
      : await window.captions.getTranslationLanguages(sourceLanguage);
    if (generation !== catalogGeneration) return;
    const enabled = new Set((addKind === "transcription"
      ? library.enabledTranscriptionLanguages
      : library.enabledTranslationPairs
        .filter((pair) => pair.sourceLanguage === sourceLanguage)
        .map((pair) => pair.targetLanguage)
    ).map((value) => value.toLocaleLowerCase("en-US")));
    catalog = languageModels(identifiers).filter((model) => (
      !enabled.has(model.value.toLocaleLowerCase("en-US"))
      && (addKind === "transcription" || !sameTranslationLanguage(model.value, sourceLanguage))
    ));
    renderCatalog();
  } catch (error) {
    if (generation !== catalogGeneration) return;
    catalog = [];
    addState.textContent = `Apple’s catalog couldn’t be loaded. ${error instanceof Error ? error.message : String(error)}`;
    addRetry.classList.remove("hidden");
  }
}

function openCatalog(kind: ModelKind): void {
  addKind = kind;
  addTitle.textContent = kind === "transcription" ? "Add transcription language" : "Add translation pair";
  addSourceField.classList.toggle("hidden", kind === "transcription");
  if (kind === "translation") {
    const sources = languageModels(library.enabledTranscriptionLanguages);
    addSource.replaceChildren(...sources.map((model) => {
      const option = document.createElement("option");
      option.value = model.value;
      option.textContent = model.name;
      return option;
    }));
    addSource.value = sources.some((model) => model.value === current.language)
      ? current.language
      : sources[0]?.value ?? "";
  }
  addSearch.value = "";
  addDialog.showModal();
  void loadCatalog();
}

async function persistGeneral(): Promise<void> {
  disableGeneralControls(true);
  try {
    current = await window.captions.saveSettings({
      ...current,
      overlayLineCount: Number(overlayLineCount.value),
      globalShortcut: selectedShortcut
    });
    renderPersistedGeneral();
    clearError();
  } catch (error) {
    renderPersistedGeneral();
    showError(error);
  } finally {
    disableGeneralControls(false);
  }
}

navButtons.forEach((button) => button.addEventListener("click", () => showPanel(button.dataset.panel)));
byId<HTMLButtonElement>("addTranscription").addEventListener("click", () => openCatalog("transcription"));
addTranslation.addEventListener("click", () => openCatalog("translation"));
byId<HTMLButtonElement>("addLanguageClose").addEventListener("click", () => addDialog.close());
addRetry.addEventListener("click", () => { void loadCatalog(); });
addSearch.addEventListener("input", renderCatalog);
addSource.addEventListener("change", () => { addSearch.value = ""; void loadCatalog(); });
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
  library = enabled;
  renderPersistedGeneral();
  renderEnabled();
  void mutate({ type: "refresh" });
}).catch(showError);
window.captions.onLanguageLibrary((enabled) => { library = enabled; renderEnabled(); });
window.addEventListener("beforeunload", () => { void window.captions.setShortcutRecording(false); });
