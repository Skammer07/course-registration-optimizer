/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * Returns a function with the same contract as Math.random(): a number in
 * [0, 1). The same seed always yields the same sequence, which lets a
 * randomized baseline run be reproduced from its stored seed.
 * NOT cryptographically secure; used only for reproducible lottery draws.
 */
export function createSeededRandom(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error("seed must be an integer between 0 and 4294967295");
  }

  let state = seed >>> 0;

  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate a fresh random 32-bit seed (used when the caller supplies none). */
export function generateSeed() {
  return Math.floor(Math.random() * 4294967296);
}
