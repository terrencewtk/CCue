import {
  app,
  BrowserWindow,
  dialog,
  screen,
  type BrowserWindowConstructorOptions,
  type Display,
  type Rectangle,
  type WebContents
} from "electron";
import { preloadScriptPath, rendererFilePath } from "../shared/runtime-paths";
import type { CaptionState, CaptureSettings, LanguageLibrary } from "../shared/types";
import type { ModelPreparationStatus } from "../onboarding/model-preparation-controller";

export interface CaptureStatus {
  state: "idle" | "connecting" | "capturing" | "error";
  detail: string;
}

export interface CaptionDebugEvent {
  source: string;
  action: string;
  text: string;
  startMs: number;
  endMs: number;
  elapsedMs: number;
  latencyMs: number;
  detail: string;
}

function rendererPath(fileName: string): string {
  return rendererFilePath(__dirname, fileName);
}

function preloadPath(): string {
  return preloadScriptPath(__dirname);
}

function webPreferences(): BrowserWindowConstructorOptions["webPreferences"] {
  return {
    preload: preloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  };
}

function restrictNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}

const OVERLAY_MIN_HEIGHT = 82;
const OVERLAY_MAX_HEIGHT = 800;

export class WindowManager {
  private controlWindow?: BrowserWindow;
  private settingsWindow?: BrowserWindow;
  private overlayWindow?: BrowserWindow;
  private onboardingWindow?: BrowserWindow;
  private completingOnboarding = false;

  createControlWindow(show = true): void {
    this.controlWindow = new BrowserWindow({
      width: 440,
      height: 620,
      resizable: false,
      title: "CCue",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor: "#fbfbfb",
      show,
      webPreferences: webPreferences()
    });
    restrictNavigation(this.controlWindow);
    void this.controlWindow.loadFile(rendererPath("control.html"));
    this.controlWindow.on("closed", () => {
      this.controlWindow = undefined;
    });
  }

  createOnboardingWindow(): void {
    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
      this.onboardingWindow.show();
      this.onboardingWindow.focus();
      return;
    }
    this.completingOnboarding = false;
    this.onboardingWindow = new BrowserWindow({
      width: 720,
      height: 640,
      minWidth: 720,
      minHeight: 640,
      resizable: true,
      minimizable: true,
      maximizable: true,
      fullscreenable: true,
      closable: true,
      title: "Welcome to CCue",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor: "#f7faf9",
      webPreferences: webPreferences()
    });
    restrictNavigation(this.onboardingWindow);
    void this.onboardingWindow.loadFile(rendererPath("onboarding.html"));
    this.onboardingWindow.on("close", () => {
      if (!this.completingOnboarding) app.quit();
    });
    this.onboardingWindow.on("closed", () => {
      this.onboardingWindow = undefined;
      this.completingOnboarding = false;
    });
  }

  completeOnboarding(): void {
    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
      this.completingOnboarding = true;
      this.onboardingWindow.close();
    }
    this.showControls();
    this.controlWindow?.focus();
  }

  createOverlayWindow(): void {
    this.overlayWindow = new BrowserWindow({
      ...this.defaultOverlayBounds(screen.getPrimaryDisplay()),
      show: false,
      transparent: true,
      frame: false,
      focusable: false,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      type: "panel",
      webPreferences: webPreferences()
    });
    restrictNavigation(this.overlayWindow);
    this.overlayWindow.setAlwaysOnTop(true, "screen-saver");
    this.overlayWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    });
    void this.overlayWindow.loadFile(rendererPath("overlay.html"));
    this.overlayWindow.setContentProtection(false);
    this.overlayWindow.on("closed", () => {
      this.overlayWindow = undefined;
    });
  }

  createSettingsWindow(): void {
    this.settingsWindow = new BrowserWindow({
      width: 1040,
      height: 720,
      minWidth: 900,
      minHeight: 560,
      title: "CCue Settings",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor: "#f7f7f7",
      show: false,
      webPreferences: webPreferences()
    });
    restrictNavigation(this.settingsWindow);
    void this.settingsWindow.loadFile(rendererPath("settings.html")).then(() => {
      this.settingsWindow?.show();
    });
    this.settingsWindow.on("closed", () => {
      this.settingsWindow = undefined;
    });
  }

  defaultOverlayBounds(
    display: Display = screen.getPrimaryDisplay(),
    height = OVERLAY_MIN_HEIGHT
  ): Rectangle {
    const width = Math.min(960, display.workArea.width - 40);
    return {
      width,
      height,
      x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
      y: display.workArea.y + display.workArea.height - height - 24
    };
  }

  repositionOverlay(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
    const height = this.overlayWindow.getBounds().height;
    this.overlayWindow.setBounds(this.defaultOverlayBounds(undefined, height));
  }

  resizeOverlay(sender: WebContents, requestedHeight: unknown): void {
    if (
      !this.overlayWindow ||
      this.overlayWindow.isDestroyed() ||
      sender !== this.overlayWindow.webContents ||
      typeof requestedHeight !== "number" ||
      !Number.isFinite(requestedHeight)
    ) return;

    const bounds = this.overlayWindow.getBounds();
    const height = Math.max(
      OVERLAY_MIN_HEIGHT,
      Math.min(OVERLAY_MAX_HEIGHT, Math.ceil(requestedHeight))
    );
    if (height === bounds.height) return;

    const display = screen.getDisplayMatching(bounds);
    const bottom = bounds.y + bounds.height;
    const y = Math.max(display.workArea.y, bottom - height);
    this.overlayWindow.setBounds({ ...bounds, y, height });
  }

  showOverlay(): void {
    if (!this.overlayWindow?.isDestroyed()) this.overlayWindow?.showInactive();
  }

  hideOverlay(): void {
    if (!this.overlayWindow?.isDestroyed()) this.overlayWindow?.hide();
  }

  showControls(): void {
    this.controlWindow?.show();
  }

  activateControls(): void {
    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
      this.onboardingWindow.show();
      this.onboardingWindow.focus();
      return;
    }
    if (!this.controlWindow || this.controlWindow.isDestroyed()) this.createControlWindow();
    else this.controlWindow.show();
  }

  showSettings(): void {
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
      this.createSettingsWindow();
      return;
    }
    if (this.settingsWindow.isMinimized()) this.settingsWindow.restore();
    this.settingsWindow.show();
    this.settingsWindow.focus();
  }

  async confirmStartWithoutTranslation(reason: string): Promise<boolean> {
    const options = {
      type: "warning" as const,
      title: "Local Translation Isn’t Ready",
      message: "Start captions without translation?",
      detail: reason,
      buttons: ["Start Without Translation", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    };
    const parent = this.controlWindow && !this.controlWindow.isDestroyed()
      ? this.controlWindow
      : this.settingsWindow && !this.settingsWindow.isDestroyed()
        ? this.settingsWindow
        : undefined;
    const result = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    return result.response === 0;
  }

  sendStatus(status: CaptureStatus): void {
    this.sendToAll("capture:status", status);
  }

  sendCaptionState(state: CaptionState): void {
    this.sendToAll("caption:update", state);
  }

  sendSessionSettings(settings: CaptureSettings): void {
    this.send(this.controlWindow, "session-settings:update", settings);
  }

  sendLanguageLibrary(library: LanguageLibrary): void {
    this.send(this.controlWindow, "language-library:update", library);
    this.send(this.settingsWindow, "language-library:update", library);
  }

  sendOnboardingStatus(status: ModelPreparationStatus): void {
    this.send(this.onboardingWindow, "onboarding:model-status", status);
  }

  sendDebug(event: CaptionDebugEvent): void {
    console.info(`[caption:${event.source}] ${event.action}`, event);
    this.send(this.controlWindow, "caption:debug", event);
  }

  private sendToAll(channel: string, payload: unknown): void {
    this.send(this.controlWindow, channel, payload);
    this.send(this.overlayWindow, channel, payload);
  }

  private send(window: BrowserWindow | undefined, channel: string, payload: unknown): void {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(channel, payload);
  }
}
