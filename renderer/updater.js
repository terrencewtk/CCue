const availableVersion = document.querySelector("#availableVersion");
const currentVersion = document.querySelector("#currentVersion");
const releaseVersion = document.querySelector("#releaseVersion");
const releaseNotes = document.querySelector("#releaseNotes");
const automaticDownload = document.querySelector("#automaticDownload");
const progressSection = document.querySelector("#progressSection");
const progressLabel = document.querySelector("#progressLabel");
const progressPercent = document.querySelector("#progressPercent");
const progress = document.querySelector("#progress");
const errorMessage = document.querySelector("#errorMessage");
const skipButton = document.querySelector("#skipButton");
const laterButton = document.querySelector("#laterButton");
const installButton = document.querySelector("#installButton");

function render(state) {
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

function renderReleaseNotes(notes) {
  const fragment = document.createDocumentFragment();
  let list = null;
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
      item.textContent = bullet[1];
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
