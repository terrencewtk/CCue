import { app, BrowserWindow, dialog, ipcMain, type WebContents } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import { preloadScriptPath, rendererFilePath } from "../shared/runtime-paths";
import { readUpdatePreferences, writeUpdatePreferences } from "./update-preferences";

type UpdateStatus = "available" | "downloading" | "ready" | "error";

interface UpdateViewModel {
  currentVersion: string;
  version: string;
  releaseNotes: string;
  automaticallyDownload: boolean;
  preview: boolean;
  status: UpdateStatus;
  percent?: number;
  error?: string;
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 10_000;
const PREVIEW_VERSION = "2.13.0";
const PREVIEW_RELEASE_NOTES = [
  "<h2>What’s Changed</h2>",
  "<h3>New features</h3>",
  "<ul>",
  "<li>Added automatic update checks</li>",
  "<li>Added release notes and download progress</li>",
  "<li>Added Skip This Version and Remind Me Later</li>",
  "<li>Improved update error handling</li>",
  "<li>Improved the updater layout for long release notes</li>",
  "<li>Minor bug fixes and improvements</li>",
  "</ul>",
  "<p>Thanks to <a href=\"https://github.com/terrencewtk\">@terrencewtk</a>.</p>"
].join("\n");

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function releaseNotesText(info: UpdateInfo): string {
  if (typeof info.releaseNotes === "string") return info.releaseNotes;
  if (Array.isArray(info.releaseNotes)) {
    return info.releaseNotes
      .map((release) => [release.version ? `Version ${release.version}` : "", release.note ?? ""]
        .filter(Boolean)
        .join("\n"))
      .filter(Boolean)
      .join("\n\n");
  }
  return "This update includes improvements and bug fixes.";
}

export class UpdateController {
  private updateWindow?: BrowserWindow;
  private updateInfo?: UpdateInfo;
  private status: UpdateStatus = "available";
  private percent?: number;
  private lastError?: string;
  private manualCheck = false;
  private checkTimer?: NodeJS.Timeout;
  private startupTimer?: NodeJS.Timeout;
  private previewTimer?: NodeJS.Timeout;
  private readonly previewMode = !app.isPackaged && process.env.CCUE_UPDATER_PREVIEW === "1";

  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-available", (info) => this.onUpdateAvailable(info));
    autoUpdater.on("update-not-available", () => this.onUpdateNotAvailable());
    autoUpdater.on("download-progress", (progress) => this.onDownloadProgress(progress));
    autoUpdater.on("update-downloaded", () => this.onUpdateDownloaded());
    autoUpdater.on("error", (error) => this.onError(error));
  }

  start(): void {
    ipcMain.handle("updater:get-state", (event) => this.getStateFor(event.sender));
    ipcMain.handle("updater:install", (event, automaticallyDownload: unknown) => (
      this.install(event.sender, automaticallyDownload === true)
    ));
    ipcMain.handle("updater:remind-later", (event, automaticallyDownload: unknown) => {
      this.assertUpdateWindow(event.sender);
      this.saveAutomaticallyDownload(automaticallyDownload === true);
      this.updateWindow?.close();
    });
    ipcMain.handle("updater:skip", (event, automaticallyDownload: unknown) => {
      this.assertUpdateWindow(event.sender);
      if (!this.updateInfo) return;
      writeUpdatePreferences({
        automaticallyDownload: automaticallyDownload === true,
        skippedVersion: this.updateInfo.version
      });
      this.updateWindow?.close();
    });

    if (this.previewMode) {
      this.showPreview();
      return;
    }
    if (!app.isPackaged) return;
    this.startupTimer = setTimeout(() => void this.checkForUpdates(false), STARTUP_CHECK_DELAY_MS);
    this.checkTimer = setInterval(() => void this.checkForUpdates(false), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.previewTimer) clearInterval(this.previewTimer);
    ipcMain.removeHandler("updater:get-state");
    ipcMain.removeHandler("updater:install");
    ipcMain.removeHandler("updater:remind-later");
    ipcMain.removeHandler("updater:skip");
  }

  async checkForUpdates(manual = true): Promise<void> {
    if (this.previewMode) {
      this.showPreview();
      return;
    }
    if (!app.isPackaged) {
      if (manual) {
        await dialog.showMessageBox({
          type: "info",
          title: "Updates unavailable in development",
          message: "Update checks only run in a packaged build.",
          detail: "Create a signed release build to test the complete update flow."
        });
      }
      return;
    }

    this.manualCheck = manual;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.onError(error);
    }
  }

  private onUpdateAvailable(info: UpdateInfo): void {
    this.updateInfo = info;
    this.status = "available";
    this.percent = undefined;
    this.lastError = undefined;
    const preferences = readUpdatePreferences();

    if (!this.manualCheck && preferences.skippedVersion === info.version) return;
    if (preferences.automaticallyDownload) {
      this.showUpdateWindow();
      void this.download();
      return;
    }
    this.showUpdateWindow();
  }

  private onUpdateNotAvailable(): void {
    if (!this.manualCheck) return;
    this.manualCheck = false;
    void dialog.showMessageBox({
      type: "info",
      title: "No Updates Available",
      message: `${app.name} ${app.getVersion()} is the latest version.`
    });
  }

  private onDownloadProgress(progress: ProgressInfo): void {
    this.status = "downloading";
    this.percent = Math.max(0, Math.min(100, progress.percent));
    this.sendState();
  }

  private onUpdateDownloaded(): void {
    this.status = "ready";
    this.percent = 100;
    this.sendState();
    // A user who chose Install Update expects the update to be applied immediately.
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 350);
  }

  private onError(error: unknown): void {
    const detail = errorMessage(error);
    console.error("[updater]", detail);
    if (this.updateWindow && !this.updateWindow.isDestroyed()) {
      this.status = "error";
      this.lastError = detail;
      this.sendState();
    } else if (this.manualCheck) {
      void dialog.showMessageBox({
        type: "error",
        title: "Unable to Check for Updates",
        message: "CCue couldn’t check for updates.",
        detail
      });
    }
    this.manualCheck = false;
  }

  private showUpdateWindow(): void {
    if (this.updateWindow && !this.updateWindow.isDestroyed()) {
      this.updateWindow.show();
      this.updateWindow.focus();
      this.sendState();
      return;
    }

    this.updateWindow = new BrowserWindow({
      width: 720,
      height: 540,
      minWidth: 640,
      minHeight: 470,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      title: `${app.name} Update`,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor: "#fbfbfb",
      show: false,
      webPreferences: {
        preload: preloadScriptPath(__dirname),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    this.updateWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.updateWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    void this.updateWindow.loadFile(rendererFilePath(__dirname, "updater.html")).then(() => {
      this.updateWindow?.show();
      this.sendState();
    });
    this.updateWindow.on("closed", () => {
      this.updateWindow = undefined;
    });
  }

  private getStateFor(sender: WebContents): UpdateViewModel {
    this.assertUpdateWindow(sender);
    return this.viewModel();
  }

  private viewModel(): UpdateViewModel {
    const preferences = readUpdatePreferences();
    return {
      currentVersion: app.getVersion(),
      version: this.updateInfo?.version ?? app.getVersion(),
      releaseNotes: this.updateInfo ? releaseNotesText(this.updateInfo) : "",
      automaticallyDownload: preferences.automaticallyDownload,
      preview: this.previewMode,
      status: this.status,
      ...(this.percent === undefined ? {} : { percent: this.percent }),
      ...(this.lastError ? { error: this.lastError } : {})
    };
  }

  private async install(sender: WebContents, automaticallyDownload: boolean): Promise<void> {
    this.assertUpdateWindow(sender);
    this.saveAutomaticallyDownload(automaticallyDownload);
    if (this.previewMode) {
      this.simulateDownload();
      return;
    }
    if (this.status === "ready") {
      autoUpdater.quitAndInstall(false, true);
      return;
    }
    await this.download();
  }

  private async download(): Promise<void> {
    if (!this.updateInfo || this.status === "downloading") return;
    this.status = "downloading";
    this.percent = 0;
    this.lastError = undefined;
    this.sendState();
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.onError(error);
    }
  }

  private saveAutomaticallyDownload(automaticallyDownload: boolean): void {
    const preferences = readUpdatePreferences();
    writeUpdatePreferences({ ...preferences, automaticallyDownload });
  }

  private showPreview(): void {
    this.updateInfo = {
      version: PREVIEW_VERSION,
      files: [],
      path: "",
      sha512: "",
      releaseDate: new Date().toISOString(),
      releaseName: `CCue ${PREVIEW_VERSION}`,
      releaseNotes: PREVIEW_RELEASE_NOTES
    };
    this.status = "available";
    this.percent = undefined;
    this.lastError = undefined;
    this.showUpdateWindow();
  }

  private simulateDownload(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.status = "downloading";
    this.percent = 0;
    this.sendState();
    this.previewTimer = setInterval(() => {
      this.percent = Math.min(100, (this.percent ?? 0) + 5);
      if (this.percent >= 100) {
        if (this.previewTimer) clearInterval(this.previewTimer);
        this.previewTimer = undefined;
        this.status = "ready";
      }
      this.sendState();
    }, 120);
  }

  private assertUpdateWindow(sender: WebContents): void {
    if (!this.updateWindow || this.updateWindow.isDestroyed() || sender !== this.updateWindow.webContents) {
      throw new Error("Updater action rejected for an unrelated window.");
    }
  }

  private sendState(): void {
    if (!this.updateWindow || this.updateWindow.isDestroyed()) return;
    this.updateWindow.webContents.send("updater:state", this.viewModel());
  }
}
