function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex] ?? rightIndex;
      previous[rightIndex] = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }

  return previous[right.length] ?? 0;
}

function longestOverlap(left: string, right: string): number {
  const maximum = Math.min(left.length, right.length);
  for (let length = maximum; length >= 2; length -= 1) {
    if (left.slice(-length).toLocaleLowerCase() === right.slice(0, length).toLocaleLowerCase()) {
      return length;
    }
  }
  return 0;
}

function looksLikeRevision(current: string, incoming: string): boolean {
  if (current.length < 5 || incoming.length < 5) return false;

  const left = current.toLocaleLowerCase();
  const right = incoming.toLocaleLowerCase();
  let sharedPrefix = 0;
  while (
    sharedPrefix < Math.min(left.length, right.length)
    && left[sharedPrefix] === right[sharedPrefix]
  ) {
    sharedPrefix += 1;
  }

  if (sharedPrefix >= 4 && sharedPrefix >= Math.min(left.length, right.length) * 0.3) return true;
  if (Math.min(left.length, right.length) < Math.max(left.length, right.length) * 0.6) return false;
  return editDistance(left, right) <= Math.ceil(Math.max(left.length, right.length) * 0.35);
}

function needsSpace(left: string, right: string): boolean {
  return /[\p{L}\p{N}]$/u.test(left) && /^[\p{L}\p{N}]/u.test(right);
}

function needsPhraseSpace(left: string, right: string): boolean {
  return /[\p{Script=Latin}\p{N}]$/u.test(left) && /^[\p{Script=Latin}\p{N}]/u.test(right);
}

export function reconcileTranscript(currentText: unknown, incomingText: unknown): string {
  const current = String(currentText || "").trim();
  const rawIncoming = String(incomingText || "");
  const startsAtWordBoundary = /^\s/u.test(rawIncoming);
  const incoming = rawIncoming.trim();
  if (!incoming) return current;
  if (!current) return incoming;

  if (startsAtWordBoundary) {
    return `${current}${needsSpace(current, incoming) ? " " : ""}${incoming}`;
  }
  if (incoming === current) return current;

  const currentLower = current.toLocaleLowerCase();
  const incomingLower = incoming.toLocaleLowerCase();
  if (incomingLower.startsWith(currentLower)) return incoming;
  if (currentLower.startsWith(incomingLower)) return current;
  if (looksLikeRevision(current, incoming)) return incoming;

  const overlap = longestOverlap(current, incoming);
  if (overlap) return `${current}${incoming.slice(overlap)}`;
  return `${current}${incoming}`;
}

export function reconcileTurnTranscript(currentText: unknown, incomingText: unknown): string {
  const current = String(currentText || "").trim();
  const incoming = String(incomingText || "").trim();
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current) return current;

  const currentLower = current.toLocaleLowerCase();
  const incomingLower = incoming.toLocaleLowerCase();
  if (incomingLower.startsWith(currentLower)) return incoming;
  if (currentLower.startsWith(incomingLower)) return current;

  const overlap = longestOverlap(current, incoming);
  if (overlap) return `${current}${incoming.slice(overlap)}`;
  if (looksLikeRevision(current, incoming)) return incoming;
  return `${current}${needsPhraseSpace(current, incoming) ? " " : ""}${incoming}`;
}
