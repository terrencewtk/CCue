const availableVersion = document.querySelector<HTMLElement>("#availableVersion")!;
const currentVersion = document.querySelector<HTMLElement>("#currentVersion")!;
const releaseVersion = document.querySelector<HTMLElement>("#releaseVersion")!;
const releaseNotes = document.querySelector<HTMLElement>("#releaseNotes")!;
const automaticDownload = document.querySelector<HTMLInputElement>("#automaticDownload")!;
const progressSection = document.querySelector<HTMLElement>("#progressSection")!;
const progressLabel = document.querySelector<HTMLElement>("#progressLabel")!;
const progressPercent = document.querySelector<HTMLElement>("#progressPercent")!;
const progress = document.querySelector<HTMLProgressElement>("#progress")!;
const errorMessage = document.querySelector<HTMLElement>("#errorMessage")!;
const skipButton = document.querySelector<HTMLButtonElement>("#skipButton")!;
const laterButton = document.querySelector<HTMLButtonElement>("#laterButton")!;
const installButton = document.querySelector<HTMLButtonElement>("#installButton")!;

function render(state: UpdaterState): void {
  availableVersion.textContent = state.version;
  currentVersion.textContent = state.currentVersion;
  releaseVersion.textContent = state.version;
  renderReleaseNotes(state.releaseNotes);
  automaticDownload.checked = state.automaticallyDownload;

  const busy = state.status === "downloading" || state.status === "ready";
  skipButton.disabled = busy;
  laterButton.disabled = busy;
  installButton.disabled = busy;
  automaticDownload.disabled = busy;
  progressSection.classList.toggle("hidden", !busy);
  errorMessage.classList.toggle("hidden", state.status !== "error");

  if (state.status === "downloading") {
    const percent = Math.round(state.percent || 0);
    progress.value = percent;
    progressPercent.textContent = `${percent}%`;
    progressLabel.textContent = "Downloading update…";
    installButton.textContent = "Downloading…";
  } else if (state.status === "ready") {
    progress.value = 100;
    progressPercent.textContent = "100%";
    progressLabel.textContent = state.preview
      ? "Preview complete—no update was installed."
      : "Update ready. Restarting CCue…";
    installButton.textContent = state.preview ? "Preview Complete" : "Restarting…";
  } else {
    installButton.textContent = state.status === "error" ? "Try Again" : "Install Update";
  }

  if (state.status === "error") errorMessage.textContent = state.error || "The update could not be downloaded.";
}

function renderReleaseNotes(notes: string): void {
  if (/<\/?(?:h[1-6]|p|ul|ol|li|strong|em|b|i|code|pre|blockquote|br|hr|a|del)\b/i.test(notes)) {
    renderHtmlReleaseNotes(notes);
    return;
  }

  const fragment = document.createDocumentFragment();
  let list: HTMLUListElement | null = null;
  for (const sourceLine of notes.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line) {
      list = null;
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      if (!list) {
        list = document.createElement("ul");
        fragment.append(list);
      }
      const item = document.createElement("li");
      item.textContent = bullet[1] ?? "";
      list.append(item);
      continue;
    }
    list = null;
    const paragraph = document.createElement("p");
    paragraph.textContent = line.replace(/^#{1,6}\s+/, "");
    fragment.append(paragraph);
  }
  releaseNotes.replaceChildren(fragment);
}

const ALLOWED_RELEASE_NOTE_ELEMENTS = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CODE", "DEL", "EM", "H1", "H2", "H3",
  "H4", "H5", "H6", "HR", "I", "LI", "OL", "P", "PRE", "STRONG", "UL"
]);
const BLOCKED_RELEASE_NOTE_ELEMENTS = new Set([
  "EMBED", "IFRAME", "MATH", "OBJECT", "SCRIPT", "STYLE", "SVG", "TEMPLATE"
]);

function renderHtmlReleaseNotes(notes: string): void {
  const parsed = new DOMParser().parseFromString(notes, "text/html");
  const fragment = document.createDocumentFragment();
  for (const child of parsed.body.childNodes) appendSanitizedReleaseNoteNode(child, fragment);
  releaseNotes.replaceChildren(fragment);
}

function appendSanitizedReleaseNoteNode(source: Node, destination: Node): void {
  if (source.nodeType === Node.TEXT_NODE) {
    destination.appendChild(document.createTextNode(source.textContent ?? ""));
    return;
  }
  if (!(source instanceof HTMLElement) || BLOCKED_RELEASE_NOTE_ELEMENTS.has(source.tagName)) return;

  if (!ALLOWED_RELEASE_NOTE_ELEMENTS.has(source.tagName)) {
    for (const child of source.childNodes) appendSanitizedReleaseNoteNode(child, destination);
    return;
  }

  const element = document.createElement(source.tagName.toLowerCase());
  if (source.tagName === "A") {
    const href = source.getAttribute("href");
    if (href) {
      try {
        const url = new URL(href);
        if (url.protocol === "http:" || url.protocol === "https:") element.setAttribute("href", url.href);
      } catch {
        // Relative and malformed links remain readable but are not made navigable.
      }
    }
  }
  for (const child of source.childNodes) appendSanitizedReleaseNoteNode(child, element);
  destination.appendChild(element);
}

skipButton.addEventListener("click", () => {
  void window.captions.skipUpdate(automaticDownload.checked);
});
laterButton.addEventListener("click", () => {
  void window.captions.remindUpdateLater(automaticDownload.checked);
});
installButton.addEventListener("click", () => {
  void window.captions.installUpdate(automaticDownload.checked);
});

window.captions.onUpdaterState(render);
window.captions.getUpdaterState().then(render);
