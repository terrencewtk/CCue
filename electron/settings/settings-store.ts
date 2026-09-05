import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  LANGUAGE_LIBRARY_VERSION,
  type CaptureSettings,
  type CaptureSettingsInput,
  type LanguageLibrary,
  type SettingsSnapshot
} from "../shared/types";
export const LEGACY_TRANSCRIPTION_LANGUAGES = ["zh-CN", "en-US", "ja-JP", "ko-KR"];
export const LEGACY_TRANSLATION_LANGUAGES = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];
const DEFAULT_OVERLAY_LINE_COUNT = 3;
const MIN_OVERLAY_LINE_COUNT = 1;
const MAX_OVERLAY_LINE_COUNT = 3;
export const DEFAULT_GLOBAL_SHORTCUT = "CommandOrControl+Shift+L";
const shortcutModifiers = new Set(["CommandOrControl", "Command", "Control", "Alt", "Shift"]);

export function canonicalLanguageIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64) return undefined;
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return undefined;
  }
}

function normalizeLocaleIdentifier(value: unknown, fallback: string): string {
  return canonicalLanguageIdentifier(value) ?? fallback;
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

function uniqueLanguages(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const language = canonicalLanguageIdentifier(value);
    const key = language?.toLocaleLowerCase("en-US");
    if (!language || !key || seen.has(key)) return [];
    seen.add(key);
    return [language];
  });
}

function libraryFrom(record: Record<string, unknown>, settings: CaptureSettings): LanguageLibrary {
  const current = record.languageLibrary;
  if (current && typeof current === "object") {
    const candidate = current as Partial<LanguageLibrary>;
    return {
      version: LANGUAGE_LIBRARY_VERSION,
      enabledTranscriptionLanguages: uniqueLanguages(candidate.enabledTranscriptionLanguages ?? []),
      enabledTranslationLanguages: uniqueLanguages(candidate.enabledTranslationLanguages ?? [])
    };
  }
  return {
    version: LANGUAGE_LIBRARY_VERSION,
    enabledTranscriptionLanguages: uniqueLanguages([...LEGACY_TRANSCRIPTION_LANGUAGES, settings.language]),
    enabledTranslationLanguages: uniqueLanguages([...LEGACY_TRANSLATION_LANGUAGES, settings.translationLanguage])
  };
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
  return readSettingsSnapshot().settings;
}

export function writeSettings(settingsInput: CaptureSettingsInput): void {
  const snapshot = readSettingsSnapshot();
  writeSettingsSnapshot({ settings: normalizeCaptureSettings(settingsInput), library: snapshot.library });
}

export function readSettingsSnapshot(): SettingsSnapshot {
  const defaults = defaultSettings();
  try {
    const stored = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;
    const settings = normalizeCaptureSettings({ ...defaults, ...stored });
    return { settings, library: libraryFrom(stored, settings) };
  } catch {
    return { settings: defaults, library: libraryFrom({}, defaults) };
  }
}

export function writeSettingsSnapshot(snapshot: SettingsSnapshot): void {
  const settings = normalizeCaptureSettings(snapshot.settings);
  const library = {
    version: LANGUAGE_LIBRARY_VERSION,
    enabledTranscriptionLanguages: uniqueLanguages(snapshot.library.enabledTranscriptionLanguages),
    enabledTranslationLanguages: uniqueLanguages(snapshot.library.enabledTranslationLanguages)
  } satisfies LanguageLibrary;
  const record = {
    language: settings.language,
    translationEnabled: settings.translationEnabled,
    translationLanguage: settings.translationLanguage,
    overlayLineCount: settings.overlayLineCount,
    globalShortcut: settings.globalShortcut,
    languageLibrary: library
  };
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  const destination = settingsPath();
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2));
  fs.renameSync(temporary, destination);
}

export function createOnboardingSnapshot(settingsInput: CaptureSettingsInput): SettingsSnapshot {
  const settings = normalizeCaptureSettings(settingsInput);
  return {
    settings,
    library: {
      version: LANGUAGE_LIBRARY_VERSION,
      enabledTranscriptionLanguages: [settings.language],
      enabledTranslationLanguages: settings.translationEnabled ? [settings.translationLanguage] : []
    }
  };
}
