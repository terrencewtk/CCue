import { resolveTranslationLanguageSelection } from "./language-catalog.js";

export interface TranslationRefreshPlan {
  identifiers: string[];
  selectedTranslationLanguage: string;
}

export function shouldPersistResolvedTranslationSelection(
  currentLanguage: string,
  currentTranslationLanguage: string,
  sourceLanguage: string,
  resolvedTranslationLanguage: string
): boolean {
  return currentLanguage !== sourceLanguage || currentTranslationLanguage !== resolvedTranslationLanguage;
}

export async function prepareTranslationRefresh(
  sourceLanguage: string,
  preferredTranslationLanguage: string,
  getTranslationLanguages: (sourceLanguage: string) => Promise<string[]>,
  isCurrent: () => boolean
): Promise<TranslationRefreshPlan | null> {
  const identifiers = await getTranslationLanguages(sourceLanguage);
  if (!isCurrent()) return null;
  const selectedTranslationLanguage = resolveTranslationLanguageSelection(
    preferredTranslationLanguage,
    sourceLanguage,
    identifiers,
    "en-US"
  );
  if (!isCurrent()) return null;
  return { identifiers, selectedTranslationLanguage };
}
