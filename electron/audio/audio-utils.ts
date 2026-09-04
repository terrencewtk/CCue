import type { AudioChunk } from "../shared/types";

export function calculatePcm16Rms(pcm: Buffer): number {
  if (pcm.length < 2) return 0;
  let sumSquares = 0;
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const sample = pcm.readInt16LE(offset) / 32768;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / Math.floor(pcm.length / 2));
}

export function trailingAudio(chunks: readonly AudioChunk[], durationMs: number): AudioChunk[] {
  const trailingChunks: AudioChunk[] = [];
  let accumulatedMs = 0;
  for (let index = chunks.length - 1; index >= 0 && accumulatedMs < durationMs; index -= 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    trailingChunks.unshift(chunk);
    accumulatedMs += chunk.durationMs;
  }
  return trailingChunks;
}

export function trimAudioBuffer(
  chunks: AudioChunk[],
  bufferedDurationMs: number,
  maximumDurationMs: number
): number {
  let durationMs = bufferedDurationMs;
  while (chunks.length && durationMs > maximumDurationMs) {
    durationMs -= chunks.shift()?.durationMs ?? 0;
  }
  return durationMs;
}
