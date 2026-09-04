/**
 * Seeded PRNG (mulberry32). Every random value in the game comes from here.
 *
 * There is deliberately NO default seed: a wall-clock default would break
 * rule 4 (no Date.now() inside src/core/) and, worse, would let a run start
 * from a seed nothing recorded — which silently breaks rule 5, since an
 * unrecorded seed cannot be replayed by the server-side verifier.
 * Callers pass a seed explicitly; picking one lives outside core.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, max). */
  int(max: number): number;
  /** Pick a uniformly random element. Throws on empty array. */
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed)) throw new TypeError(`Seed must be an integer, got ${seed}`);
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max) => Math.floor(next() * max),
    pick: (items) => {
      if (items.length === 0) throw new Error('Cannot pick from an empty array');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
  };
}
