import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  LANGUAGE_LIBRARY_VERSION,
  type CaptureSettings,
  type CaptureSettingsInput,
  type LanguageLibrary,
  type SettingsSnapshot,
  type TranslationPair
} from "../shared/types";
export const LEGACY_TRANSCRIPTION_LANGUAGES = ["zh-CN", "en-US", "ja-JP", "ko-KR"];
export const LEGACY_TRANSLATION_LANGUAGES = ["zh-Hans", "zh-Hant", "en", "ja", "ko"];
const LEGACY_TRANSLATION_LANGUAGE_MIGRATIONS: Readonly<Record<string, string>> = {
  "zh-CN": "zh-Hans",
  "zh-TW": "zh-Hant",
  "en-US": "en",
  "ja-JP": "ja",
  "ko-KR": "ko"
};
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
  return normalizeLocaleIdentifier(value, "en");
}

function migrateLegacyTranslationLanguage(value: string): string {
  return LEGACY_TRANSLATION_LANGUAGE_MIGRATIONS[value] ?? value;
}

function sameLanguage(left: string, right: string): boolean {
  try {
    const a = new Intl.Locale(left).maximize();
    const b = new Intl.Locale(right).maximize();
    return a.language === b.language && (a.language !== "zh" || a.script === b.script);
  } catch {
    return left.toLocaleLowerCase() === right.toLocaleLowerCase();
  }
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
    translationLanguage: "en",
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

function uniqueTranslationPairs(values: readonly unknown[], enabledSources: readonly string[]): TranslationPair[] {
  const sources = new Set(enabledSources.map((value) => value.toLocaleLowerCase("en-US")));
  const seen = new Set<string>();
  return values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as Partial<TranslationPair>;
    const sourceLanguage = canonicalLanguageIdentifier(candidate.sourceLanguage);
    const targetLanguage = canonicalLanguageIdentifier(candidate.targetLanguage);
    if (!sourceLanguage || !targetLanguage || sameLanguage(sourceLanguage, targetLanguage)) return [];
    if (!sources.has(sourceLanguage.toLocaleLowerCase("en-US"))) return [];
    const key = `${sourceLanguage.toLocaleLowerCase("en-US")}\u0000${targetLanguage.toLocaleLowerCase("en-US")}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ sourceLanguage, targetLanguage }];
  });
}

function libraryFrom(record: Record<string, unknown>, settings: CaptureSettings): LanguageLibrary {
  const current = record.languageLibrary;
  if (current && typeof current === "object") {
    const candidate = current as Partial<LanguageLibrary> & { enabledTranslationLanguages?: unknown[] };
    const enabledTranscriptionLanguages = uniqueLanguages(candidate.enabledTranscriptionLanguages ?? []);
    const pairValues = Array.isArray(candidate.enabledTranslationPairs)
      ? candidate.enabledTranslationPairs
      : (candidate.enabledTranslationLanguages ?? []).map((targetLanguage) => ({
        sourceLanguage: settings.language,
        targetLanguage: typeof targetLanguage === "string"
          ? migrateLegacyTranslationLanguage(targetLanguage)
          : ""
      }));
    return {
      version: LANGUAGE_LIBRARY_VERSION,
      enabledTranscriptionLanguages,
      enabledTranslationPairs: uniqueTranslationPairs(pairValues, enabledTranscriptionLanguages)
    };
  }
  const enabledTranscriptionLanguages = uniqueLanguages([...LEGACY_TRANSCRIPTION_LANGUAGES, settings.language]);
  return {
    version: LANGUAGE_LIBRARY_VERSION,
    enabledTranscriptionLanguages,
    enabledTranslationPairs: uniqueTranslationPairs(
      [...LEGACY_TRANSLATION_LANGUAGES, settings.translationLanguage].map((targetLanguage) => ({
        sourceLanguage: settings.language,
        targetLanguage
      })),
      enabledTranscriptionLanguages
    )
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
    const normalized = normalizeCaptureSettings({ ...defaults, ...stored });
    const storedLibrary = stored.languageLibrary && typeof stored.languageLibrary === "object"
      ? stored.languageLibrary as Record<string, unknown>
      : undefined;
    const settings = storedLibrary && Array.isArray(storedLibrary.enabledTranslationPairs)
      ? normalized
      : { ...normalized, translationLanguage: migrateLegacyTranslationLanguage(normalized.translationLanguage) };
    return { settings, library: libraryFrom(stored, settings) };
  } catch {
    return { settings: defaults, library: libraryFrom({}, defaults) };
  }
}

export function writeSettingsSnapshot(snapshot: SettingsSnapshot): void {
  const settings = normalizeCaptureSettings(snapshot.settings);
  const enabledTranscriptionLanguages = uniqueLanguages(snapshot.library.enabledTranscriptionLanguages);
  const library = {
    version: LANGUAGE_LIBRARY_VERSION,
    enabledTranscriptionLanguages,
    enabledTranslationPairs: uniqueTranslationPairs(
      snapshot.library.enabledTranslationPairs,
      enabledTranscriptionLanguages
    )
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
      enabledTranslationPairs: settings.translationEnabled && !sameLanguage(settings.language, settings.translationLanguage)
        ? [{ sourceLanguage: settings.language, targetLanguage: settings.translationLanguage }]
        : []
    }
  };
}
