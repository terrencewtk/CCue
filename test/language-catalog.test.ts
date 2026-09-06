import assert from "node:assert/strict";
import test from "node:test";
import {
  deduplicateLanguages,
  filterLanguages,
  languageModels,
  resolveLanguageSelection,
  resolveTranslationLanguageSelection,
  sameTranslationLanguage,
  translationTargetsForSource
} from "../renderer/language-catalog";

test("language discovery canonicalizes and deduplicates stable identifiers", () => {
  assert.deepEqual(
    deduplicateLanguages(["en-us", "en-US", "ja_JP", "ja-JP", "zh-hans"]),
    ["en-US", "ja-JP", "zh-Hans"]
  );
});

test("language models sort deterministically by localized display name", () => {
  const models = languageModels(["ja-JP", "fr-FR", "en-US", "de-DE"], "en-US");
  const collator = new Intl.Collator("en-US", { sensitivity: "base", numeric: true });
  assert.deepEqual(
    models.map((model) => model.name),
    models.map((model) => model.name).sort(collator.compare)
  );
  assert.ok(models.every((model) => model.name && model.nativeName && model.searchText));
});

test("language filtering searches localized, native, and identifier text", () => {
  const models = languageModels(["en-US", "ja-JP", "zh-Hans"], "en-US");
  assert.deepEqual(filterLanguages(models, "日本").map((model) => model.value), ["ja-JP"]);
  assert.deepEqual(filterLanguages(models, "zh hans").map((model) => model.value), ["zh-Hans"]);
  assert.deepEqual(filterLanguages(models, "missing"), []);
});

test("existing region-specific selections resolve to Apple's language identifiers", () => {
  assert.equal(resolveLanguageSelection("en-US", ["fr", "en", "ja"], "en-US"), "en");
  assert.equal(resolveLanguageSelection("ja-JP", ["fr", "en", "ja"], "en-US"), "ja");
  assert.equal(resolveLanguageSelection("xx", ["fr", "en", "ja"], "en-US"), "en");
});

test("translation language equality distinguishes Chinese scripts", () => {
  assert.equal(sameTranslationLanguage("en-US", "en-GB"), true);
  assert.equal(sameTranslationLanguage("zh-CN", "zh-Hans"), true);
  assert.equal(sameTranslationLanguage("zh-TW", "zh-Hant"), true);
  assert.equal(sameTranslationLanguage("zh-Hans", "zh-Hant"), false);
});

test("translation selection never invents a target", () => {
  assert.equal(resolveTranslationLanguageSelection("en-US", "ja-JP", [], "en-US"), null);
  assert.equal(resolveTranslationLanguageSelection("en-US", "ja-JP", ["fr"], "en-US"), "fr");
  assert.equal(resolveTranslationLanguageSelection("zh-CN", "zh-Hans", ["zh-CN"], "en-US"), null);
});

test("translation targets are filtered by their exact source identifier", () => {
  const pairs = [
    { sourceLanguage: "ja-JP", targetLanguage: "en" },
    { sourceLanguage: "fr-FR", targetLanguage: "en" },
    { sourceLanguage: "fr-FR", targetLanguage: "de" }
  ];
  assert.deepEqual(translationTargetsForSource(pairs, "fr-FR"), ["en", "de"]);
  assert.deepEqual(translationTargetsForSource(pairs, "ja-JP"), ["en"]);
  assert.deepEqual(translationTargetsForSource(pairs, "fr-CA"), []);
});
