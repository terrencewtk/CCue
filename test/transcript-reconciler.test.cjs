const test = require("node:test");
const assert = require("node:assert/strict");
const {
  reconcileTranscript,
  reconcileTurnTranscript
} = require("../build/electron/captions/transcript-reconciler.js");

test("starts a caption and ignores empty updates", () => {
  assert.equal(reconcileTranscript("", "  Hello  "), "Hello");
  assert.equal(reconcileTranscript("Hello", "  "), "Hello");
});

test("joins streamed subwords, word boundaries, and punctuation", () => {
  assert.equal(reconcileTranscript("To", "day"), "Today");
  assert.equal(reconcileTranscript("Today", " we"), "Today we");
  assert.equal(reconcileTranscript("We are te", "sting"), "We are testing");
  assert.equal(reconcileTranscript("How are you", "?"), "How are you?");
});

test("keeps repeated words that arrive as distinct boundary fragments", () => {
  assert.equal(reconcileTranscript("very", " very"), "very very");
});

test("extends cumulative and overlapping updates without duplication", () => {
  assert.equal(reconcileTranscript("Hello wor", "Hello world"), "Hello world");
  assert.equal(reconcileTranscript("Hello wor", "world"), "Hello world");
});

test("replaces a revised partial transcript", () => {
  assert.equal(reconcileTranscript("The cat sat on the mat", "The cat sat near the mat"), "The cat sat near the mat");
  assert.equal(reconcileTranscript("I scream", "ice cream"), "ice cream");
});

test("does not roll back when an older cumulative update arrives", () => {
  assert.equal(reconcileTranscript("This is the newest text", "This is the"), "This is the newest text");
});

test("removes overlap between artificial English turns", () => {
  assert.equal(
    reconcileTurnTranscript("We need accurate live", "live captions now"),
    "We need accurate live captions now"
  );
});

test("adds an English phrase boundary when turns do not overlap", () => {
  assert.equal(reconcileTurnTranscript("Hello world", "This is next"), "Hello world This is next");
});

test("joins Japanese turns without inserting spaces", () => {
  assert.equal(
    reconcileTurnTranscript("システム音声を", "音声を録音します"),
    "システム音声を録音します"
  );
  assert.equal(reconcileTurnTranscript("今日は", "良い天気です"), "今日は良い天気です");
});
