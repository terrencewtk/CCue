const test = require("node:test");
const assert = require("node:assert/strict");
const {
  commitQuality,
  latestQualityEnd,
  replaceDraft,
  renderTimeline,
  segmentDraftSentences,
  setQualityTranslation,
  upsertDraft
} = require("../build/electron/captions/caption-timeline.js");

test("replaces a local partial and keeps its translation paired", () => {
  const records = [];
  replaceDraft(records, { id: 1, startMs: 100, endMs: 500 }, "おは", "Good");
  replaceDraft(records, { id: 1, startMs: 100, endMs: 800 }, "おはよう", "Good morning");
  assert.deepEqual(renderTimeline(records).rows, [{
    text: "おはよう",
    translation: "Good morning",
    kind: "draft"
  }]);
});

test("retains the previous draft translation until its replacement arrives", () => {
  const records = [];
  replaceDraft(records, { id: 1, startMs: 100, endMs: 500 }, "今日は", "今天");
  replaceDraft(records, { id: 1, startMs: 100, endMs: 800 }, "今日は晴れです", "", true);
  assert.deepEqual(renderTimeline(records).rows, [{
    text: "今日は晴れです",
    translation: "今天",
    kind: "draft"
  }]);

  replaceDraft(records, { id: 1, startMs: 100, endMs: 800 }, "今日は晴れです", "今天是晴天");
  assert.equal(renderTimeline(records).rows[0].translation, "今天是晴天");
});

test("shows the next local partial after a finalized utterance", () => {
  const records = [];
  replaceDraft(records, { id: 1, startMs: 0, endMs: 800 }, "最初", "First");
  commitQuality(records, {
    id: "apple-speech-1",
    startMs: 0,
    endMs: 800,
    text: "最初",
    translation: "First"
  });

  // The empty snapshot after <end> initially has timestamp zero. The next
  // provisional response then updates this draft with its real timestamps.
  replaceDraft(records, { id: 2, startMs: 0, endMs: 0 }, "", "");
  replaceDraft(records, { id: 2, startMs: 900, endMs: 1_300 }, "次の途中", "Next partial");

  assert.deepEqual(renderTimeline(records).rows, [
    { text: "最初", translation: "First", kind: "quality" },
    { text: "次の途中", translation: "Next partial", kind: "draft" }
  ]);
});

test("segments unfinished text at English and Chinese full stops", () => {
  assert.deepEqual(
    segmentDraftSentences("First sentence. 第二句。 Still speaking"),
    ["First sentence.", "第二句。", "Still speaking"]
  );
  assert.deepEqual(segmentDraftSentences("Wait... Really。"), ["Wait...", "Really。"]);
});

test("renders completed draft sentences as separate rolling rows", () => {
  const records = [];
  upsertDraft(records, { id: 1, startMs: 0, endMs: 2_000 }, "一文目です。二文目です。まだ途中");
  assert.deepEqual(renderTimeline(records), {
    finals: ["一文目です。", "二文目です。"],
    partial: "まだ途中",
    rows: [
      { text: "一文目です。", translation: "", kind: "draft" },
      { text: "二文目です。", translation: "", kind: "draft" },
      { text: "まだ途中", translation: "", kind: "draft" }
    ]
  });
});

test("pairs segmented draft translations by sentence", () => {
  const records = [];
  replaceDraft(
    records,
    { id: 1, startMs: 0, endMs: 2_000 },
    "一文目です。二文目です。まだ途中",
    "First sentence\nSecond sentence\nStill speaking"
  );

  assert.deepEqual(renderTimeline(records).rows, [
    { text: "一文目です。", translation: "First sentence", kind: "draft" },
    { text: "二文目です。", translation: "Second sentence", kind: "draft" },
    { text: "まだ途中", translation: "Still speaking", kind: "draft" }
  ]);
});

test("commits quality text and removes fast text before its endpoint", () => {
  const records = [];
  upsertDraft(records, { id: 1, startMs: 0, endMs: 2_000 }, "久しぶりに");
  upsertDraft(records, { id: 2, startMs: 1_800, endMs: 3_800 }, "食べたの차오이");
  upsertDraft(records, { id: 3, startMs: 3_600, endMs: 5_600 }, "とてもおいしい");

  assert.equal(commitQuality(records, {
    id: "quality-1",
    startMs: 0,
    endMs: 5_600,
    text: "久しぶりに食べたので、とても美味しかったです。"
  }), true);
  assert.deepEqual(renderTimeline(records), {
    finals: [],
    partial: "久しぶりに食べたので、とても美味しかったです。",
    rows: [{ text: "久しぶりに食べたので、とても美味しかったです。", translation: "", kind: "quality" }]
  });
});

test("keeps fast text that starts at the quality endpoint", () => {
  const records = [];
  upsertDraft(records, { id: 1, startMs: 0, endMs: 2_000 }, "first draft");
  upsertDraft(records, { id: 2, startMs: 2_000, endMs: 4_000 }, "later draft");
  commitQuality(records, { id: "quality-1", startMs: 0, endMs: 2_000, text: "corrected first" });
  assert.deepEqual(renderTimeline(records), {
    finals: ["corrected first"],
    partial: "later draft",
    rows: [
      { text: "corrected first", translation: "", kind: "quality" },
      { text: "later draft", translation: "", kind: "draft" }
    ]
  });
});

test("suppresses a late draft covered by an earlier quality result", () => {
  const records = [];
  assert.equal(commitQuality(records, {
    id: "quality-1",
    startMs: 0,
    endMs: 2_000,
    text: "corrected"
  }), true);
  upsertDraft(records, { id: 1, startMs: 0, endMs: 2_000 }, "late draft");
  assert.deepEqual(renderTimeline(records), {
    finals: [],
    partial: "corrected",
    rows: [{ text: "corrected", translation: "", kind: "quality" }]
  });
});

test("segments and pairs a translated quality turn", () => {
  const records = [];
  commitQuality(records, {
    id: "quality-1",
    startMs: 0,
    endMs: 4_000,
    text: "朝早く起きました。カーテンを開けます。"
  });
  assert.equal(setQualityTranslation(
    records,
    "quality-1",
    "I woke up early. I open the curtains."
  ), true);
  assert.deepEqual(renderTimeline(records).rows, [
    {
      text: "朝早く起きました。",
      translation: "I woke up early.",
      kind: "quality"
    },
    {
      text: "カーテンを開けます。",
      translation: "I open the curtains.",
      kind: "quality"
    }
  ]);
});

test("finalizes visible segments without resurfacing evicted draft segments", () => {
  const records = [];
  const evictedRowIds = new Set();
  replaceDraft(
    records,
    { id: 1, startMs: 0, endMs: 5_000 },
    "Draft one. Draft two. Draft three. Draft four. Draft five."
  );

  assert.deepEqual(renderTimeline(records, evictedRowIds).rows.map((row) => row.text), [
    "Draft three.",
    "Draft four.",
    "Draft five."
  ]);
  assert.equal(evictedRowIds.size, 2);

  commitQuality(records, {
    id: "quality-1",
    startMs: 0,
    endMs: 5_000,
    text: "Final one. Final two. Final three. Final four. Final five."
  });
  assert.deepEqual(renderTimeline(records, evictedRowIds).rows.map((row) => row.text), [
    "Final three.",
    "Final four.",
    "Final five."
  ]);
});

test("does not backfill evicted rows when the final result is shorter", () => {
  const records = [];
  const evictedRowIds = new Set();
  replaceDraft(
    records,
    { id: 1, startMs: 0, endMs: 5_000 },
    "Draft one. Draft two. Draft three. Draft four. Draft five."
  );
  renderTimeline(records, evictedRowIds);

  commitQuality(records, {
    id: "quality-1",
    startMs: 0,
    endMs: 5_000,
    text: "Final one. Final two. Final three."
  });
  assert.deepEqual(renderTimeline(records, evictedRowIds).rows.map((row) => row.text), [
    "Final three."
  ]);
});

test("appends quality turns without replacing earlier quality text", () => {
  const records = [];
  commitQuality(records, {
    id: "quality-1",
    startMs: 0,
    endMs: 2_000,
    text: "最初の品質文。"
  });
  upsertDraft(records, { id: 1, startMs: 2_000, endMs: 4_000 }, "fast text");
  commitQuality(records, {
    id: "quality-2",
    startMs: 2_000,
    endMs: 4_000,
    text: "次の品質文。"
  });
  upsertDraft(records, { id: 2, startMs: 4_000, endMs: 6_000 }, "new fast text");

  assert.equal(latestQualityEnd(records), 4_000);
  assert.deepEqual(renderTimeline(records).rows, [
    { text: "最初の品質文。", translation: "", kind: "quality" },
    { text: "次の品質文。", translation: "", kind: "quality" },
    { text: "new fast text", translation: "", kind: "draft" }
  ]);
});

test("uses the last three sentence rows when a draft fills the display", () => {
  const records = [];
  commitQuality(records, {
    id: "quality-1",
    startMs: 0,
    endMs: 2_000,
    text: "品質一。"
  });
  commitQuality(records, {
    id: "quality-2",
    startMs: 2_000,
    endMs: 4_000,
    text: "品質二。"
  });
  upsertDraft(records, {
    id: 1,
    startMs: 4_000,
    endMs: 6_000
  }, "fast one. fast two. fast three.");

  assert.deepEqual(renderTimeline(records).rows, [
    { text: "fast one.", translation: "", kind: "draft" },
    { text: "fast two.", translation: "", kind: "draft" },
    { text: "fast three.", translation: "", kind: "draft" }
  ]);
});

test("uses the configured overlay line count", () => {
  const records = [];
  upsertDraft(records, {
    id: 1,
    startMs: 0,
    endMs: 6_000
  }, "one. two. three. four. five.");

  assert.deepEqual(renderTimeline(records, undefined, 5).rows.map((row) => row.text), [
    "one.",
    "two.",
    "three.",
    "four.",
    "five."
  ]);
  assert.deepEqual(renderTimeline(records, undefined, 2).rows.map((row) => row.text), [
    "four.",
    "five."
  ]);
});
