import { resolveTranslationLanguageSelection } from "./language-catalog.js";

export interface TranslationRefreshPlan {
  identifiers: string[];
  selectedTranslationLanguage: string;
}

export async function prepareTranslationRefresh(
  sourceLanguage: string,
  preferredTranslationLanguage: string,
  getTranslationLanguages: (sourceLanguage: string) => Promise<string[]>,
  persistSelection: (selectedTranslationLanguage: string) => Promise<void>,
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
  await persistSelection(selectedTranslationLanguage);
  if (!isCurrent()) return null;
  return { identifiers, selectedTranslationLanguage };
}
