const wrap = document.querySelector("#captionWrap");
const captionLines = document.querySelector("#captionLines");
const stopButton = document.querySelector("#stopButton");

let active = false;
let animationFrame = null;
let animationIntervalMs = 20;
let lastAnimationTime = 0;
let targetCaption = { rows: [], units: [] };
let visibleUnitCount = 0;
let resizeFrame = null;
let lastRequestedOverlayHeight = 0;

const OVERLAY_VERTICAL_GUTTER = 24;
const CAPTION_MIN_HEIGHT = 58;

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function revealUnits(text) {
  const units = [];
  let leading = "";

  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    if (isWordLike) {
      units.push(`${leading}${segment}`);
      leading = "";
    } else if (units.length) {
      units[units.length - 1] += segment;
    } else {
      leading += segment;
    }
  }

  if (leading) units.push(leading);
  return units;
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left[length] === right[length]) length += 1;
  return length;
}

function suffixPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  for (let length = limit; length > 0; length -= 1) {
    let matches = true;
    for (let index = 0; index < length; index += 1) {
      if (left[left.length - length + index] !== right[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return length;
  }
  return 0;
}

function captionTarget(finals, partial, rows) {
  const sourceRows = rows?.length
    ? rows
    : [...finals, partial]
      .filter(Boolean)
      .map((text) => ({ text, translation: "", kind: "draft" }));
  const targetRows = sourceRows.map((row) => ({
    text: row.text,
    translation: row.translation || "",
    animate: row.kind !== "quality",
    units: revealUnits(row.text)
  }));
  return {
    rows: targetRows,
    units: targetRows.flatMap((row) => row.animate ? row.units : [])
  };
}

function renderVisibleCaption() {
  let remaining = visibleUnitCount;
  const elements = [];
  for (const row of targetCaption.rows) {
    const visible = row.animate
      ? row.units.slice(0, Math.max(0, remaining)).join("")
      : row.text;
    if (row.animate) remaining -= row.units.length;
    if (!visible) continue;

    const line = document.createElement("div");
    line.className = "caption-line";
    const transcript = document.createElement("p");
    transcript.className = "transcript-text";
    transcript.textContent = visible;
    line.append(transcript);
    if (row.translation) {
      const translation = document.createElement("p");
      translation.className = "translation-text";
      translation.textContent = row.translation;
      line.append(translation);
    }
    elements.push(line);
  }
  captionLines.replaceChildren(...elements);
  updateVisibility();
  captionLines.scrollTop = captionLines.scrollHeight;
  captionLines.classList.toggle(
    "is-overflowing",
    captionLines.scrollHeight > captionLines.clientHeight + 1
  );
  scheduleOverlayResize();
}

function scheduleOverlayResize() {
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    if (wrap.classList.contains("hidden")) return;

    const style = getComputedStyle(wrap);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const contentHeight = Math.max(CAPTION_MIN_HEIGHT, captionLines.scrollHeight + padding);
    const height = Math.ceil(contentHeight + OVERLAY_VERTICAL_GUTTER);
    if (height === lastRequestedOverlayHeight) return;
    lastRequestedOverlayHeight = height;
    window.captions.resizeOverlay(height);
  });
}

function animateCaption(timestamp) {
  if (!lastAnimationTime) lastAnimationTime = timestamp;
  const elapsed = timestamp - lastAnimationTime;
  const increment = Math.floor(elapsed / animationIntervalMs);
  if (increment > 0) {
    visibleUnitCount = Math.min(
      targetCaption.units.length,
      visibleUnitCount + increment
    );
    lastAnimationTime += increment * animationIntervalMs;
    renderVisibleCaption();
  }

  if (visibleUnitCount < targetCaption.units.length) {
    animationFrame = requestAnimationFrame(animateCaption);
  } else {
    animationFrame = null;
  }
}

function setCaption(finals, partial, rows) {
  const previous = targetCaption;
  const next = captionTarget(finals, partial, rows);
  const prefix = commonPrefixLength(previous.units, next.units);
  const shiftedPrefix = suffixPrefixLength(previous.units, next.units);

  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;

  if (!next.units.length) {
    visibleUnitCount = 0;
  } else if (reducedMotion.matches) {
    visibleUnitCount = next.units.length;
  } else if (prefix === previous.units.length) {
    visibleUnitCount = Math.min(visibleUnitCount, prefix);
  } else if (shiftedPrefix > prefix && shiftedPrefix >= 2) {
    const removed = previous.units.length - shiftedPrefix;
    visibleUnitCount = Math.min(
      shiftedPrefix,
      Math.max(0, visibleUnitCount - removed)
    );
  } else if (prefix >= 2) {
    visibleUnitCount = Math.min(visibleUnitCount, prefix);
  } else {
    // Large draft rewrites replace the prior draft without replaying it.
    visibleUnitCount = next.units.length;
  }

  targetCaption = next;
  renderVisibleCaption();

  const pending = next.units.length - visibleUnitCount;
  if (pending > 0 && !reducedMotion.matches) {
    animationIntervalMs = Math.max(25, Math.min(90, 650 / pending));
    visibleUnitCount += 1;
    lastAnimationTime = 0;
    renderVisibleCaption();
    animationFrame = requestAnimationFrame(animateCaption);
  }
}

function updateVisibility() {
  wrap.classList.toggle("hidden", !active && !captionLines.textContent);
  scheduleOverlayResize();
}

new ResizeObserver(scheduleOverlayResize).observe(captionLines);
document.fonts.ready.then(scheduleOverlayResize);

window.captions.onCaption(({ finals, partial, rows }) => {
  setCaption(finals, partial, rows);
});

window.captions.onStatus(({ state }) => {
  active = state === "capturing";
  stopButton.disabled = !active;
  updateVisibility();
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  try {
    await window.captions.stop();
  } finally {
    if (active) stopButton.disabled = false;
  }
});
