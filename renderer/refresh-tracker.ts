export function createRefreshTracker() {
  let generation = 0;

  return {
    next(): number {
      generation += 1;
      return generation;
    },
    isCurrent(value: number): boolean {
      return value === generation;
    }
  };
}
