export interface ScheduledTranslation {
  segments: readonly string[];
  isCurrent: () => boolean;
  complete: (translations: string[]) => void;
}

interface QueuedTranslation extends ScheduledTranslation {
  epoch: number;
}

/**
 * Serializes access to the local translation model while preserving every
 * final caption and coalescing speculative partial-caption work.
 */
export class LatestTranslationScheduler {
  private readonly pendingFinals: QueuedTranslation[] = [];
  private pendingPartial?: QueuedTranslation;
  private running = false;
  private epoch = 0;
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly translate: (text: string) => Promise<string>,
    private readonly onError: (error: unknown) => void,
    private readonly cacheLimit = 256
  ) {}

  submitPartial(job: ScheduledTranslation): void {
    this.pendingPartial = { ...job, epoch: this.epoch };
    this.pump();
  }

  discardPartial(): void {
    this.pendingPartial = undefined;
  }

  submitFinal(job: ScheduledTranslation): void {
    this.pendingFinals.push({ ...job, epoch: this.epoch });
    this.pump();
  }

  reset(): void {
    this.epoch += 1;
    this.pendingFinals.length = 0;
    this.pendingPartial = undefined;
    this.cache.clear();
  }

  private pump(): void {
    if (this.running) return;
    this.running = true;
    void this.run().finally(() => {
      this.running = false;
      if (this.pendingFinals.length || this.pendingPartial) this.pump();
    });
  }

  private async run(): Promise<void> {
    while (true) {
      const job = this.nextJob();
      if (!job) return;

      try {
        const translations: string[] = [];
        for (const segment of job.segments) {
          if (!this.isCurrent(job)) break;
          translations.push(await this.translateCached(segment, job.epoch));
        }
        if (translations.length === job.segments.length && this.isCurrent(job)) {
          job.complete(translations);
        }
      } catch (error) {
        if (this.isCurrent(job)) this.onError(error);
      }
    }
  }

  private nextJob(): QueuedTranslation | undefined {
    while (this.pendingFinals.length) {
      const final = this.pendingFinals.shift()!;
      if (this.isCurrent(final)) return final;
    }
    const partial = this.pendingPartial;
    this.pendingPartial = undefined;
    return partial && this.isCurrent(partial) ? partial : undefined;
  }

  private isCurrent(job: QueuedTranslation): boolean {
    return job.epoch === this.epoch && job.isCurrent();
  }

  private async translateCached(segment: string, epoch: number): Promise<string> {
    const cached = this.cache.get(segment);
    if (cached !== undefined) {
      this.cache.delete(segment);
      this.cache.set(segment, cached);
      return cached;
    }

    const translation = await this.translate(segment);
    // A helper from the previous capture session can settle after reset(). Its
    // result must not leak into a cache used by a different language pair.
    if (epoch !== this.epoch) return translation;
    this.cache.set(segment, translation);
    if (this.cache.size > this.cacheLimit) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    return translation;
  }
}
