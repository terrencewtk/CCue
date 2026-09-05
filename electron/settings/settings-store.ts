import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { CaptureSettings, CaptureSettingsInput } from "../shared/types";
const DEFAULT_OVERLAY_LINE_COUNT = 3;
const MIN_OVERLAY_LINE_COUNT = 1;
const MAX_OVERLAY_LINE_COUNT = 3;
export const DEFAULT_GLOBAL_SHORTCUT = "CommandOrControl+Shift+L";
const shortcutModifiers = new Set(["CommandOrControl", "Command", "Control", "Alt", "Shift"]);

function normalizeLocaleIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length > 64) return fallback;
  try {
    return Intl.getCanonicalLocales(value)[0] ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeLanguage(value: unknown): string {
  return normalizeLocaleIdentifier(value, "ja-JP");
}

function normalizeTranslationLanguage(value: unknown): string {
  return normalizeLocaleIdentifier(value, "en-US");
}

function normalizeOverlayLineCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(count)) return DEFAULT_OVERLAY_LINE_COUNT;
  return Math.min(MAX_OVERLAY_LINE_COUNT, Math.max(MIN_OVERLAY_LINE_COUNT, Math.round(count)));
}

function normalizeGlobalShortcut(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return DEFAULT_GLOBAL_SHORTCUT;
  const parts = value.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = parts.slice(0, -1);
  const validKey = /^[A-Z0-9]$/.test(key)
    || /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)
    || ["Space", "Return", "Tab", "Backspace", "Delete", "Up", "Down", "Left", "Right"].includes(key);
  const hasPrimaryModifier = modifiers.some((modifier) => (
    ["CommandOrControl", "Command", "Control", "Alt"].includes(modifier)
  ));
  const uniqueModifiers = new Set(modifiers);
  if (
    !validKey
    || modifiers.some((modifier) => !shortcutModifiers.has(modifier))
    || uniqueModifiers.size !== modifiers.length
    || (!hasPrimaryModifier && !key.startsWith("F"))
  ) return DEFAULT_GLOBAL_SHORTCUT;
  return [...modifiers, key].join("+");
}

function defaultSettings(): CaptureSettings {
  return {
    language: "ja-JP",
    translationEnabled: true,
    translationLanguage: "en-US",
    overlayLineCount: DEFAULT_OVERLAY_LINE_COUNT,
    globalShortcut: DEFAULT_GLOBAL_SHORTCUT
  };
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function normalizeCaptureSettings(settings: CaptureSettingsInput): CaptureSettings {
  return {
    language: normalizeLanguage(settings.language),
    translationEnabled: settings.translationEnabled !== false,
    translationLanguage: normalizeTranslationLanguage(settings.translationLanguage),
    overlayLineCount: normalizeOverlayLineCount(settings.overlayLineCount),
    globalShortcut: normalizeGlobalShortcut(settings.globalShortcut)
  };
}

export function readSettings(): CaptureSettings {
  const defaults = defaultSettings();
  try {
    const stored = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as CaptureSettingsInput;
    const settings = normalizeCaptureSettings({ ...defaults, ...stored });
    return settings;
  } catch {
    return defaults;
  }
}

export function writeSettings(settingsInput: CaptureSettingsInput): void {
  const settings = normalizeCaptureSettings(settingsInput);
  const record: CaptureSettingsInput = {
    language: settings.language,
    translationEnabled: settings.translationEnabled,
    translationLanguage: settings.translationLanguage,
    overlayLineCount: settings.overlayLineCount,
    globalShortcut: settings.globalShortcut
  };
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(record, null, 2));
}
