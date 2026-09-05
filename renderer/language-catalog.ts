export interface LanguageModel {
  value: string;
  name: string;
  nativeName: string;
  searchText: string;
}

export const LEGACY_TRANSCRIPTION_LANGUAGES = ["zh-CN", "en-US", "ja-JP", "ko-KR"];
export const LEGACY_TRANSLATION_LANGUAGES = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];

export function canonicalLanguageIdentifier(value: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return undefined;
  }
}

export function deduplicateLanguages(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const canonical = canonicalLanguageIdentifier(value);
    if (!canonical) continue;
    const key = canonical.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(canonical);
  }
  return result;
}

function displayName(value: string, locales: string | string[]): string {
  try {
    return new Intl.DisplayNames(locales, { type: "language", languageDisplay: "standard" }).of(value) ?? value;
  } catch {
    return value;
  }
}

export function languageModels(
  values: readonly string[],
  displayLocales: string | string[] = navigator.languages as string[]
): LanguageModel[] {
  const collator = new Intl.Collator(displayLocales, { sensitivity: "base", numeric: true });
  return deduplicateLanguages(values).map((value) => {
    const name = displayName(value, displayLocales);
    let nativeName = name;
    try {
      const locale = new Intl.Locale(value);
      nativeName = displayName(value, locale.language);
    } catch {}
    return {
      value,
      name,
      nativeName,
      searchText: `${name} ${nativeName} ${value}`.toLocaleLowerCase()
    };
  }).sort((left, right) => collator.compare(left.name, right.name) || left.value.localeCompare(right.value));
}

export function filterLanguages(models: readonly LanguageModel[], query: string): LanguageModel[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return terms.length ? models.filter((model) => terms.every((term) => model.searchText.includes(term))) : [...models];
}

export function sameTranslationLanguage(left: string, right: string): boolean {
  try {
    const a = new Intl.Locale(left).maximize();
    const b = new Intl.Locale(right).maximize();
    if (a.language !== b.language) return false;
    return a.language !== "zh" || a.script === b.script;
  } catch {
    return left.toLocaleLowerCase() === right.toLocaleLowerCase();
  }
}

export function resolveLanguageSelection(
  preferred: string,
  available: readonly string[],
  fallback: string
): string {
  const canonicalPreferred = canonicalLanguageIdentifier(preferred);
  const exact = canonicalPreferred && available.find((value) => (
    canonicalLanguageIdentifier(value)?.toLocaleLowerCase("en-US") === canonicalPreferred.toLocaleLowerCase("en-US")
  ));
  if (exact) return exact;
  const equivalent = available.find((value) => sameTranslationLanguage(value, preferred));
  return equivalent ?? available.find((value) => sameTranslationLanguage(value, fallback)) ?? available[0] ?? fallback;
}

export function resolveTranslationLanguageSelection(
  preferred: string,
  sourceLanguage: string,
  available: readonly string[],
  fallback: string
): string {
  const validTargets = available.filter((target) => !sameTranslationLanguage(target, sourceLanguage));
  return resolveLanguageSelection(preferred, validTargets, fallback);
}

export async function discoverLanguages(
  bridge: {
    getTranscriptionLanguages(): Promise<string[]>;
    getTranslationLanguages(sourceLanguage?: string): Promise<string[]>;
  },
  sourceLanguage?: string
): Promise<{ transcription: string[]; translation: string[] }> {
  const [transcription, translation] = await Promise.all([
    bridge.getTranscriptionLanguages(),
    bridge.getTranslationLanguages(sourceLanguage)
  ]);
  return {
    transcription: deduplicateLanguages(transcription),
    translation: deduplicateLanguages(translation)
  };
}
